-- Verifies the survey WhatsApp sender (migration 20260930120000) against the LIVE
-- database without changing it: everything runs in one transaction that ROLLS BACK.
-- Safe on production — the API URL is pointed at a dead local port and the key is
-- fake, and uncommitted pg_net requests are never picked up by its worker.
--
--   psql "<pooler conn>" -X -v ON_ERROR_STOP=1 -f scripts/verify-survey-whatsapp.sql
--
-- Prints PASS lines; any failure raises and aborts.

BEGIN;
\i supabase/migrations/20260930120000_survey_whatsapp_reminder.sql
\i supabase/migrations/20260930130000_survey_whatsapp_message_id.sql

CREATE FUNCTION pg_temp.expect(label text, actual anyelement, expected anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: got %, expected %', label, actual, expected;
  END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- ── Phone normalization ─────────────────────────────────────────────────────
SELECT pg_temp.expect('IL local dashed',        public.normalize_phone_intl('054-123-4567'), '972541234567');
SELECT pg_temp.expect('IL local plain',         public.normalize_phone_intl('0541234567'), '972541234567');
SELECT pg_temp.expect('IL +972',                public.normalize_phone_intl('+972 54-123-4567'), '972541234567');
SELECT pg_temp.expect('IL +972 with 0',         public.normalize_phone_intl('+972 054-123-4567'), '972541234567');
SELECT pg_temp.expect('IL 00972',               public.normalize_phone_intl('00972541234567'), '972541234567');
SELECT pg_temp.expect('IL missing 0',           public.normalize_phone_intl('541234567'), '972541234567');
SELECT pg_temp.expect('Chile +56',              public.normalize_phone_intl('+56 9 1234 5678'), '56912345678');
SELECT pg_temp.expect('Argentina 549 no plus',  public.normalize_phone_intl('54 9 11 2345-6789'), '5491123456789');
SELECT pg_temp.expect('IL landline rejected',   public.normalize_phone_intl('02-123-4567'), NULL::text);
SELECT pg_temp.expect('garbage rejected',       public.normalize_phone_intl('123'), NULL::text);
SELECT pg_temp.expect('empty rejected',         public.normalize_phone_intl('  '), NULL::text);

-- ── Send slot: 2nd Wednesday, 10:00 Israel time (IDT UTC+3 / IST UTC+2) ────
SELECT pg_temp.expect('2nd Wed Oct 10:00 IDT',  public.is_survey_whatsapp_slot('2026-10-14 07:00Z', 10), true);
SELECT pg_temp.expect('2nd Wed Oct 10:59 IDT',  public.is_survey_whatsapp_slot('2026-10-14 07:59Z', 10), true);
SELECT pg_temp.expect('2nd Wed Oct 09:59 IDT',  public.is_survey_whatsapp_slot('2026-10-14 06:59Z', 10), false);
SELECT pg_temp.expect('1st Wed Oct',            public.is_survey_whatsapp_slot('2026-10-07 07:00Z', 10), false);
SELECT pg_temp.expect('3rd Wed Oct',            public.is_survey_whatsapp_slot('2026-10-21 07:00Z', 10), false);
SELECT pg_temp.expect('2nd Wed Nov 10:00 IST',  public.is_survey_whatsapp_slot('2026-11-11 08:00Z', 10), true);
SELECT pg_temp.expect('2nd Wed Nov 09:00 IST',  public.is_survey_whatsapp_slot('2026-11-11 07:00Z', 10), false);
SELECT pg_temp.expect('2nd Wed Jan 2027',       public.is_survey_whatsapp_slot('2027-01-13 08:00Z', 10), true);
SELECT pg_temp.expect('Thursday day 8',         public.is_survey_whatsapp_slot('2026-10-08 07:00Z', 10), false);

-- ── Enqueue against real students ───────────────────────────────────────────
-- Test-only config: dead endpoint, fake channel, small batch.
UPDATE public.survey_whatsapp_config
   SET api_url = 'http://127.0.0.1:9/never', channel_id = 'test-channel', batch_per_minute = 5;

SELECT pg_temp.expect('disabled + not forced does nothing', public.survey_whatsapp_enqueue(), 0);

CREATE TEMP TABLE expected_students AS
SELECT pr.id, public.normalize_phone_intl(pr.phone) AS phone, pr.phone AS raw_phone
FROM public.profiles pr JOIN auth.users u ON u.id = pr.id
WHERE pr.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pr.id AND r.role = 'student')
  AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = pr.id AND r.role IN ('admin','instructor','super_admin'))
  AND NOT EXISTS (SELECT 1 FROM public.satisfaction_survey_responses s
                  WHERE s.user_id = pr.id AND s.period = date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')::date);

SELECT pg_temp.expect('forced enqueue covers every paying student',
  public.survey_whatsapp_enqueue(true), (SELECT count(*)::int FROM expected_students));
SELECT pg_temp.expect('queued = students with a valid phone',
  (SELECT count(*)::int FROM public.survey_whatsapp_sends WHERE status = 'queued'),
  (SELECT count(*)::int FROM expected_students WHERE phone IS NOT NULL));
SELECT pg_temp.expect('skipped no_phone = students without a phone',
  (SELECT count(*)::int FROM public.survey_whatsapp_sends WHERE reason = 'no_phone'),
  (SELECT count(*)::int FROM expected_students WHERE coalesce(btrim(raw_phone), '') = ''));
SELECT pg_temp.expect('no lead / staff / role-less account enqueued',
  (SELECT count(*)::int FROM public.survey_whatsapp_sends s WHERE NOT EXISTS
     (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role = 'student')), 0);
SELECT pg_temp.expect('enqueue is idempotent', public.survey_whatsapp_enqueue(true), 0);

-- ── Dispatch ────────────────────────────────────────────────────────────────
SELECT pg_temp.expect('disabled → dispatch sends nothing', public.survey_whatsapp_dispatch(), 0);
UPDATE public.survey_whatsapp_config SET enabled = true;
SELECT pg_temp.expect('no key in vault → dispatch sends nothing',
  CASE WHEN EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'lychee_api_key') THEN 0
       ELSE public.survey_whatsapp_dispatch() END, 0);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'lychee_api_key') THEN
    PERFORM vault.create_secret('lyc_test_fake_key', 'lychee_api_key');
  END IF;
END $$;

-- A queued student who answers in the meantime must be skipped, not messaged.
CREATE TEMP TABLE answered AS
  SELECT user_id FROM public.survey_whatsapp_sends WHERE status = 'queued' ORDER BY created_at LIMIT 1;
INSERT INTO public.satisfaction_survey_responses
  (user_id, tenure, would_recommend, overall_satisfaction, needs_improvement,
   rating_clarity, rating_continuity, rating_lives, rating_ai, rating_feedback, contribution, suggestions)
SELECT user_id, 'gt_1m', true, 4, ARRAY['ai'], 4, 3, 4, 2, 3, 'x', 'y' FROM answered;

SELECT pg_temp.expect('dispatch sends one batch (answered one skipped)', public.survey_whatsapp_dispatch(), 4);
SELECT pg_temp.expect('answered student skipped',
  (SELECT status || '/' || reason FROM public.survey_whatsapp_sends WHERE user_id = (SELECT user_id FROM answered)),
  'skipped/already_answered');
SELECT pg_temp.expect('4 rows sending with request ids',
  (SELECT count(*)::int FROM public.survey_whatsapp_sends WHERE status = 'sending' AND request_id IS NOT NULL), 4);

-- The request that would go to Lychee: right endpoint, template, variables, headers.
CREATE TEMP TABLE sample AS
  SELECT s.*, q.url, q.body, q.headers
  FROM public.survey_whatsapp_sends s JOIN net.http_request_queue q ON q.id = s.request_id
  WHERE s.status = 'sending' ORDER BY s.created_at LIMIT 1;
SELECT pg_temp.expect('request goes to the configured URL', (SELECT url FROM sample), 'http://127.0.0.1:9/never');
SELECT pg_temp.expect('template name', (SELECT convert_from(body, 'UTF8')::jsonb ->> 'template_name' FROM sample), 'survey_clients');
SELECT pg_temp.expect('phone is normalized', (SELECT convert_from(body, 'UTF8')::jsonb ->> 'phone' FROM sample), (SELECT phone FROM sample));
SELECT pg_temp.expect('body_variables = [first name, link]',
  (SELECT convert_from(body, 'UTF8')::jsonb -> 'body_variables' FROM sample),
  (SELECT jsonb_build_array(first_name, 'https://app.rominahebreo.com/encuesta') FROM sample));
SELECT pg_temp.expect('idempotency key per student per month',
  (SELECT headers ->> 'Idempotency-Key' FROM sample),
  (SELECT 'survey-' || to_char(period, 'YYYY-MM') || '-' || user_id FROM sample));
SELECT pg_temp.expect('bearer auth header', (SELECT headers ->> 'Authorization' LIKE 'Bearer %' FROM sample), true);

-- ── Reconcile: simulate Lychee's answers for the 4 in-flight requests ──────
-- #1 uses the real success shape observed in production (camelCase messageId).
CREATE TEMP TABLE inflight AS
  SELECT id, request_id, row_number() OVER (ORDER BY created_at) AS n
  FROM public.survey_whatsapp_sends WHERE status = 'sending';
INSERT INTO net._http_response (id, status_code, content, timed_out, error_msg, created)
SELECT request_id,
       CASE n WHEN 1 THEN 200 WHEN 2 THEN 429 WHEN 3 THEN 400 END,
       CASE n WHEN 1 THEN '{"ok":true,"messageId":"msg-1","waId":"wamid.x"}'
              WHEN 2 THEN '{"error":"rate limited"}'
              WHEN 3 THEN '{"error":"Template not found"}' END,
       false, NULL, now()
FROM inflight WHERE n <= 3;
-- #4 never answered, and has been in flight for an hour.
UPDATE public.survey_whatsapp_sends SET updated_at = now() - interval '1 hour'
 WHERE id = (SELECT id FROM inflight WHERE n = 4);

SELECT pg_temp.expect('reconcile handles all four', public.survey_whatsapp_reconcile(), 4);
SELECT pg_temp.expect('200 → sent with message id',
  (SELECT status || '/' || message_id FROM public.survey_whatsapp_sends WHERE id = (SELECT id FROM inflight WHERE n = 1)), 'sent/msg-1');
SELECT pg_temp.expect('429 → back in queue for retry',
  (SELECT status || '/' || attempts || '/' || reason FROM public.survey_whatsapp_sends WHERE id = (SELECT id FROM inflight WHERE n = 2)),
  'queued/1/retry: rate limited');
SELECT pg_temp.expect('400 → failed with Lychee''s error',
  (SELECT status || '/' || reason FROM public.survey_whatsapp_sends WHERE id = (SELECT id FROM inflight WHERE n = 3)),
  'failed/Template not found');
SELECT pg_temp.expect('no response after 30 min → failed',
  (SELECT status || '/' || reason FROM public.survey_whatsapp_sends WHERE id = (SELECT id FROM inflight WHERE n = 4)),
  'failed/no response from Lychee');

-- A row that keeps hitting 429 gives up after 3 attempts.
UPDATE public.survey_whatsapp_sends SET status = 'sending', attempts = 3, request_id = -42
 WHERE id = (SELECT id FROM inflight WHERE n = 2);
INSERT INTO net._http_response (id, status_code, content, timed_out, created) VALUES (-42, 429, '{"error":"rate limited"}', false, now());
SELECT public.survey_whatsapp_reconcile();
SELECT pg_temp.expect('429 on 3rd attempt → failed',
  (SELECT status FROM public.survey_whatsapp_sends WHERE id = (SELECT id FROM inflight WHERE n = 2)), 'failed');

-- ── Access control ──────────────────────────────────────────────────────────
DO $$
DECLARE student uuid := (SELECT id FROM expected_students LIMIT 1);
        adm uuid := (SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1);
        n int; denied boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.survey_whatsapp_sends;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student can read send log (% rows)', n; END IF;
  SELECT count(*) INTO n FROM public.survey_whatsapp_config;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL student can read config'; END IF;
  BEGIN PERFORM public.survey_whatsapp_dispatch(); denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL student can call dispatch'; END IF;
  BEGIN PERFORM public.survey_whatsapp_enqueue(true); denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL student can call enqueue'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS student: no log/config read, no function calls';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.survey_whatsapp_sends;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL admin cannot read send log'; END IF;
  BEGIN UPDATE public.survey_whatsapp_config SET enabled = false; denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL admin can flip the switch through the API'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS admin: reads log (% rows), cannot write config via API', n;
END $$;

-- ── Schedule ────────────────────────────────────────────────────────────────
SELECT pg_temp.expect('cron job scheduled on Wednesdays',
  (SELECT schedule FROM cron.job WHERE jobname = 'survey-whatsapp-tick'), '* * * * 3');

ROLLBACK;
