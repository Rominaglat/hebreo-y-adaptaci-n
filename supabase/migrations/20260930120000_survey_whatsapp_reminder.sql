-- Monthly WhatsApp nudge for the satisfaction survey, sent through Lychee
-- (WhatsApp Business API, template `survey_clients`) on the SECOND WEDNESDAY of
-- every month at 10:00 Israel time, to paying students — effective role
-- 'student' — who have a phone and haven't answered that month's survey yet.
--
-- Runs entirely inside Postgres: pg_cron ticks, pg_net makes the HTTP calls,
-- Vault holds the Lychee API key (secret name 'lychee_api_key', loaded from
-- .env by scripts/sync-lychee-key.sh). No edge function, so nothing to deploy
-- beyond this migration.
--
--   tick (every minute on Wednesdays)
--     1. enqueue    — only inside the 10:00 slot of the 2nd Wednesday; one row per
--                     student per month in survey_whatsapp_sends (queued / skipped)
--     2. reconcile  — reads pg_net responses → sent / failed / re-queued (429, 5xx)
--     3. dispatch   — sends up to batch_per_minute queued rows
--
-- SENDING IS OFF until survey_whatsapp_config.enabled = true.
-- To stop:  UPDATE public.survey_whatsapp_config SET enabled = false;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Config (single row, no secrets) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_whatsapp_config (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),   -- exactly one row
  enabled           boolean NOT NULL DEFAULT false,
  channel_id        text,                                          -- Lychee list_channels id
  template_name     text NOT NULL DEFAULT 'survey_clients',
  template_language text NOT NULL DEFAULT 'es',
  -- Template {{1}}, {{2}}… in order. Tokens: 'name' (first name) and 'link'.
  body_variables    text[] NOT NULL DEFAULT ARRAY['name', 'link']
                    CHECK (body_variables <@ ARRAY['name', 'link']::text[]),
  survey_url        text NOT NULL DEFAULT 'https://app.rominahebreo.com/encuesta',
  api_url           text NOT NULL DEFAULT 'https://app.lychee-ltd.com/api/wap/make-send-template',
  send_hour         smallint NOT NULL DEFAULT 10 CHECK (send_hour BETWEEN 0 AND 23),
  batch_per_minute  smallint NOT NULL DEFAULT 10 CHECK (batch_per_minute BETWEEN 1 AND 100),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.survey_whatsapp_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ── Send log / queue ────────────────────────────────────────────────────────
-- Data class: role-gated (holds phone numbers) — admins read, nobody writes via API.
CREATE TABLE IF NOT EXISTS public.survey_whatsapp_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period      date NOT NULL,                  -- survey month (first day, Israel time)
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       text,                           -- normalized international digits
  first_name  text,
  status      text NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  reason      text,                           -- no_phone, invalid_phone, already_answered, API error…
  attempts    smallint NOT NULL DEFAULT 0,
  request_id  bigint,                         -- pg_net request id while 'sending'
  http_status integer,
  message_id  text,                           -- Lychee message id once accepted
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, user_id)                    -- never message a student twice in a month
);
CREATE INDEX IF NOT EXISTS idx_survey_whatsapp_sends_pending
  ON public.survey_whatsapp_sends (status) WHERE status IN ('queued', 'sending');

ALTER TABLE public.survey_whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_whatsapp_sends  ENABLE ROW LEVEL SECURITY;

-- Admins read both (the admin tab shows the monthly send status). No write
-- policies: only the SECURITY DEFINER functions below (run by pg_cron) write.
DROP POLICY IF EXISTS survey_whatsapp_config_admin_read ON public.survey_whatsapp_config;
CREATE POLICY survey_whatsapp_config_admin_read ON public.survey_whatsapp_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS survey_whatsapp_sends_admin_read ON public.survey_whatsapp_sends;
CREATE POLICY survey_whatsapp_sends_admin_read ON public.survey_whatsapp_sends
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

REVOKE ALL ON public.survey_whatsapp_config, public.survey_whatsapp_sends FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.survey_whatsapp_config, public.survey_whatsapp_sends FROM authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Profiles hold phones as typed: mostly Israeli local ("054-123-4567"), some
-- international ("+569…", "54 9 11 …"). WhatsApp needs bare international digits.
CREATE OR REPLACE FUNCTION public.normalize_phone_intl(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(raw, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF btrim(raw) LIKE '+%' THEN
    NULL;                                          -- already international
  ELSIF d LIKE '00%' THEN
    d := substr(d, 3);                             -- 00-prefixed international
  ELSIF d ~ '^0[57]\d{8}$' THEN
    d := '972' || substr(d, 2);                    -- Israeli local mobile / VoIP
  ELSIF d ~ '^5\d{8}$' THEN
    d := '972' || d;                               -- Israeli mobile missing its 0
  END IF;
  IF d ~ '^9720' THEN d := '972' || substr(d, 5); END IF;   -- "+972 054…"
  IF length(d) < 10 OR length(d) > 15 THEN RETURN NULL; END IF;
  RETURN d;
END $$;

-- The send slot: the 2nd Wednesday of the month (always day 8–14), at send_hour, Israel time.
CREATE OR REPLACE FUNCTION public.is_survey_whatsapp_slot(ts timestamptz, send_hour int)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT extract(isodow FROM ts AT TIME ZONE 'Asia/Jerusalem') = 3
     AND extract(day    FROM ts AT TIME ZONE 'Asia/Jerusalem') BETWEEN 8 AND 14
     AND extract(hour   FROM ts AT TIME ZONE 'Asia/Jerusalem') = send_hour
$$;

CREATE OR REPLACE FUNCTION public.try_jsonb(t text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN t::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END $$;

-- ── 1. Enqueue ──────────────────────────────────────────────────────────────
-- force => ignore the slot/enabled checks (manual runs). Idempotent per month.
CREATE OR REPLACE FUNCTION public.survey_whatsapp_enqueue(force boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.survey_whatsapp_config;
  p   date := date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')::date;
  n   integer;
BEGIN
  SELECT * INTO cfg FROM public.survey_whatsapp_config WHERE id;
  IF NOT force AND (NOT cfg.enabled OR NOT public.is_survey_whatsapp_slot(now(), cfg.send_hour)) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.survey_whatsapp_sends (period, user_id, phone, first_name, status, reason)
  SELECT p, pr.id, ph.phone, split_part(btrim(pr.full_name), ' ', 1),
         CASE WHEN ph.phone IS NULL THEN 'skipped' ELSE 'queued' END,
         CASE WHEN coalesce(btrim(pr.phone), '') = '' THEN 'no_phone'
              WHEN ph.phone IS NULL THEN 'invalid_phone' END
  FROM public.profiles pr
  JOIN auth.users u ON u.id = pr.id
  CROSS JOIN LATERAL (SELECT public.normalize_phone_intl(pr.phone) AS phone) ph
  WHERE pr.deleted_at IS NULL
    -- paying = holds the student role (leads, staff and role-less test accounts excluded)
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pr.id AND r.role = 'student')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                    WHERE r.user_id = pr.id AND r.role IN ('admin', 'instructor', 'super_admin'))
    AND NOT EXISTS (SELECT 1 FROM public.satisfaction_survey_responses s
                    WHERE s.user_id = pr.id AND s.period = p)
  ON CONFLICT (period, user_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 2. Reconcile pg_net responses ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_whatsapp_reconcile()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; body jsonb; n integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.attempts, s.updated_at,
           h.id AS resp_id, h.status_code, h.content, h.timed_out, h.error_msg
    FROM public.survey_whatsapp_sends s
    LEFT JOIN net._http_response h ON h.id = s.request_id
    WHERE s.status = 'sending'
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    IF r.resp_id IS NULL THEN
      -- pg_net keeps responses 6h; nothing after 30 min means it's lost.
      IF r.updated_at < now() - interval '30 minutes' THEN
        UPDATE public.survey_whatsapp_sends
           SET status = 'failed', reason = 'no response from Lychee', updated_at = now()
         WHERE id = r.id;
        n := n + 1;
      END IF;
      CONTINUE;
    END IF;

    body := public.try_jsonb(r.content);
    IF r.status_code BETWEEN 200 AND 299 AND coalesce(body ->> 'ok', 'true') <> 'false' THEN
      UPDATE public.survey_whatsapp_sends
         SET status = 'sent', http_status = r.status_code, message_id = body ->> 'message_id',
             reason = NULL, request_id = NULL, updated_at = now()
       WHERE id = r.id;
    ELSIF (r.timed_out OR r.status_code IS NULL OR r.status_code IN (429, 500, 502, 503, 504))
          AND r.attempts < 3 THEN
      -- Transient: back in the queue; the same Idempotency-Key guards against a double send.
      UPDATE public.survey_whatsapp_sends
         SET status = 'queued', http_status = r.status_code, request_id = NULL,
             reason = left('retry: ' || coalesce(body ->> 'error', r.error_msg, 'HTTP ' || r.status_code), 300),
             updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.survey_whatsapp_sends
         SET status = 'failed', http_status = r.status_code, request_id = NULL,
             reason = left(coalesce(body ->> 'error', r.error_msg, 'HTTP ' || r.status_code), 300),
             updated_at = now()
       WHERE id = r.id;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ── 3. Dispatch ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.survey_whatsapp_dispatch()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.survey_whatsapp_config; api_key text; r record; vars jsonb; rid bigint; n integer := 0;
BEGIN
  SELECT * INTO cfg FROM public.survey_whatsapp_config WHERE id;
  IF NOT cfg.enabled THEN RETURN 0; END IF;
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'lychee_api_key';
  -- Misconfigured: leave rows queued rather than burn them as failures.
  IF coalesce(api_key, '') = '' OR coalesce(cfg.channel_id, '') = '' THEN RETURN 0; END IF;

  FOR r IN
    SELECT * FROM public.survey_whatsapp_sends
    WHERE status = 'queued'
    ORDER BY created_at
    LIMIT cfg.batch_per_minute
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Answered since being queued → don't nag.
    IF EXISTS (SELECT 1 FROM public.satisfaction_survey_responses s
               WHERE s.user_id = r.user_id AND s.period = r.period) THEN
      UPDATE public.survey_whatsapp_sends
         SET status = 'skipped', reason = 'already_answered', updated_at = now()
       WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT coalesce(jsonb_agg(CASE v WHEN 'name' THEN r.first_name ELSE cfg.survey_url END ORDER BY ord), '[]'::jsonb)
      INTO vars
      FROM unnest(cfg.body_variables) WITH ORDINALITY AS t(v, ord);

    rid := net.http_post(
      url     := cfg.api_url,
      body    := jsonb_build_object(
                   'phone', r.phone,
                   'channel_id', cfg.channel_id,
                   'template_name', cfg.template_name,
                   'language', cfg.template_language,
                   'body_variables', vars),
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || api_key,
                   'Content-Type', 'application/json',
                   'Idempotency-Key', 'survey-' || to_char(r.period, 'YYYY-MM') || '-' || r.user_id),
      timeout_milliseconds := 15000
    );

    UPDATE public.survey_whatsapp_sends
       SET status = 'sending', request_id = rid, attempts = attempts + 1, updated_at = now()
     WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.survey_whatsapp_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.survey_whatsapp_enqueue();
  PERFORM public.survey_whatsapp_reconcile();
  PERFORM public.survey_whatsapp_dispatch();
END $$;

-- Nothing here is callable through the API — pg_cron runs as postgres.
REVOKE EXECUTE ON FUNCTION
  public.survey_whatsapp_enqueue(boolean),
  public.survey_whatsapp_reconcile(),
  public.survey_whatsapp_dispatch(),
  public.survey_whatsapp_tick()
FROM PUBLIC, anon, authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- Every minute, but only on Wednesdays (UTC Wednesday fully covers 10:00 Israel
-- time): the enqueue step acts only in the 10:00 slot of the 2nd Wednesday, the
-- queue drains at batch_per_minute, and retries land the same day. Keeping it
-- to Wednesdays keeps cron.job_run_details small.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'survey-whatsapp-tick') THEN
    PERFORM cron.unschedule('survey-whatsapp-tick');
  END IF;
  PERFORM cron.schedule('survey-whatsapp-tick', '* * * * 3', 'SELECT public.survey_whatsapp_tick();');
END$$;
