-- =============================================================================
-- Student subscriptions — a synced copy of the "תלמידים" tab of the customer
-- tracking Google Sheet, feeding the revenue dashboard on /admin/users.
--
-- The sheet stays the place subscriptions are edited. The edge function
-- sync-subscriptions-sheet reads it hourly (and on demand) and replaces this
-- table wholesale through replace_student_subscriptions().
--
-- Spec: docs/superpowers/specs/2026-10-10-student-subscriptions-dashboard-design.md
--
-- DATA CLASSIFICATION
--   student_subscriptions  — role-gated: names, emails, phones and what each
--                            student pays. Admin / super_admin read; writes
--                            only via service_role (the sync).
--   subscription_sync_runs — role-gated: sync health log. Same access.
-- Instructors can open Manage Users read-only, but they do NOT see revenue.
-- =============================================================================

-- ── student_subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_row           integer NOT NULL,
  full_name           text,
  email               text,
  phone               text,
  status              text NOT NULL
                        CHECK (status IN ('active', 'cancelled', 'payment_failed', 'unknown')),
  status_raw          text,
  monthly_price       numeric(10, 2) CHECK (monthly_price IS NULL OR monthly_price >= 0),
  started_at          date,
  started_at_source   text CHECK (started_at_source IN ('sheet', 'platform_signup')),
  cancelled_at        date,
  cancelled_at_source text CHECK (cancelled_at_source IN ('sheet', 'access_revoked', 'last_activity')),
  user_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  match_method        text CHECK (match_method IN ('email', 'phone')),
  match_note          text,
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_subscriptions_user_id_idx
  ON public.student_subscriptions (user_id);

ALTER TABLE public.student_subscriptions ENABLE ROW LEVEL SECURITY;

-- Read: admins only. No INSERT/UPDATE/DELETE policies — deny-all for every API
-- role; the sync writes as service_role, which bypasses RLS.
DROP POLICY IF EXISTS "Admins read student subscriptions" ON public.student_subscriptions;
CREATE POLICY "Admins read student subscriptions"
  ON public.student_subscriptions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

-- Least privilege on top of RLS: anon gets nothing, authenticated only reads.
REVOKE ALL ON public.student_subscriptions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.student_subscriptions FROM authenticated;

-- ── subscription_sync_runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_sync_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger      text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  rows_total   integer,
  rows_matched integer,
  error        text
);

CREATE INDEX IF NOT EXISTS subscription_sync_runs_started_at_idx
  ON public.subscription_sync_runs (started_at DESC);

ALTER TABLE public.subscription_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read subscription sync runs" ON public.subscription_sync_runs;
CREATE POLICY "Admins read subscription sync runs"
  ON public.subscription_sync_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()));

REVOKE ALL ON public.subscription_sync_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.subscription_sync_runs FROM authenticated;

-- ── replace_student_subscriptions ────────────────────────────────────────────
-- DELETE + INSERT in one transaction, so the dashboard never reads a
-- half-synced table. SECURITY INVOKER on purpose: only service_role may call it,
-- and if that grant were ever widened by mistake, RLS (no write policies) would
-- still refuse the writes.
CREATE OR REPLACE FUNCTION public.replace_student_subscriptions(_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'replace_student_subscriptions: _rows must be a JSON array';
  END IF;

  DELETE FROM public.student_subscriptions WHERE true;

  INSERT INTO public.student_subscriptions (
    sheet_row, full_name, email, phone, status, status_raw, monthly_price,
    started_at, started_at_source, cancelled_at, cancelled_at_source,
    user_id, match_method, match_note, synced_at
  )
  SELECT
    r.sheet_row, r.full_name, r.email, r.phone, r.status, r.status_raw, r.monthly_price,
    r.started_at, r.started_at_source, r.cancelled_at, r.cancelled_at_source,
    r.user_id, r.match_method, r.match_note, now()
  FROM jsonb_to_recordset(_rows) AS r(
    sheet_row integer, full_name text, email text, phone text, status text,
    status_raw text, monthly_price numeric, started_at date, started_at_source text,
    cancelled_at date, cancelled_at_source text, user_id uuid, match_method text,
    match_note text
  );

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_student_subscriptions(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_student_subscriptions(jsonb) TO service_role;

-- ── Schedule ─────────────────────────────────────────────────────────────────
-- Hourly, at :07 to stay clear of the top-of-hour jobs. Until the Google
-- secrets are set, each run just logs error = 'not_configured' and leaves the
-- table as it is.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  service_url text := 'https://gmepopxxvgcwiqlkpuwd.supabase.co/functions/v1/sync-subscriptions-sheet';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-subscriptions-sheet') THEN
    PERFORM cron.schedule(
      'invoke-sync-subscriptions-sheet',
      '7 * * * *',
      format(
        $cron$SELECT net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"trigger":"cron"}'::jsonb) AS request_id;$cron$,
        service_url
      )
    );
    RAISE NOTICE 'Scheduled invoke-sync-subscriptions-sheet (7 * * * *).';
  ELSE
    RAISE NOTICE 'invoke-sync-subscriptions-sheet already scheduled — leaving as is.';
  END IF;
END$$;
