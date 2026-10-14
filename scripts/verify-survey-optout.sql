-- scripts/verify-survey-optout.sql — behavioural proof for the survey reminder
-- opt-outs and the cancelled-subscription skip.
--
-- Applies 20261014100000_survey_reminder_optouts.sql, exercises it against
-- three real students picked from the live data, and ROLLS BACK. Nothing is
-- kept: this month's send rows for those three are deleted and re-enqueued
-- only inside this transaction (pg_cron cannot see uncommitted rows, so
-- nothing is ever dispatched), and the migration itself is undone.
--
-- Run from the repo root:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-survey-optout.sql
--
-- Every check is an ASSERT: silent on success, aborts with the rule's name otherwise.

BEGIN;

\i supabase/migrations/20261014100000_survey_reminder_optouts.sql

DO $verify$
DECLARE
  p        date := date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')::date;
  u_active uuid;  -- student, active in the sheet, valid phone, hasn't answered
  u_optout uuid;  -- a second such student, opted out by an admin
  u_cancel uuid;  -- student whose every sheet row is cancelled
  r        record;
  n        integer;
  blocked  boolean;
BEGIN
  -- ── Fixtures: real students (reads only; every write below rolls back) ──
  WITH eligible AS (
    SELECT pr.id FROM public.profiles pr
    WHERE pr.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = pr.id AND x.role = 'student')
      AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                      WHERE x.user_id = pr.id AND x.role IN ('admin', 'instructor', 'super_admin'))
      AND NOT EXISTS (SELECT 1 FROM public.satisfaction_survey_responses s
                      WHERE s.user_id = pr.id AND s.period = p)
      AND public.normalize_phone_intl(pr.phone) IS NOT NULL
  )
  SELECT
    (SELECT e.id FROM eligible e
      WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status = 'active')
      ORDER BY e.id LIMIT 1),
    (SELECT e.id FROM eligible e
      WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status = 'active')
      ORDER BY e.id OFFSET 1 LIMIT 1),
    (SELECT e.id FROM eligible e
      WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM public.student_subscriptions ss
                        WHERE ss.user_id = e.id AND ss.status <> 'cancelled')
      ORDER BY e.id LIMIT 1)
  INTO u_active, u_optout, u_cancel;

  ASSERT u_active IS NOT NULL AND u_optout IS NOT NULL AND u_cancel IS NOT NULL,
    'fixtures: need two active students and one cancelled student in the live data';

  -- ── Enqueue rules ──
  DELETE FROM public.survey_whatsapp_sends WHERE period = p AND user_id IN (u_active, u_optout, u_cancel);
  INSERT INTO public.survey_reminder_optouts (user_id, source) VALUES (u_optout, 'admin');

  PERFORM public.survey_whatsapp_enqueue(true);

  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_active;
  ASSERT r.status = 'queued' AND r.reason IS NULL, 'an active student is still queued';

  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_optout;
  ASSERT r.status = 'skipped' AND r.reason = 'opted_out', 'an opted-out student is skipped as opted_out';

  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_cancel;
  ASSERT r.status = 'skipped' AND r.reason = 'subscription_cancelled',
    'a student whose subscription is cancelled is skipped as subscription_cancelled';

  -- Opted out wins over cancelled (both true => the student's own wish is the reason shown).
  DELETE FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_cancel;
  INSERT INTO public.survey_reminder_optouts (user_id, source) VALUES (u_cancel, 'admin');
  PERFORM public.survey_whatsapp_enqueue(true);
  SELECT reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_cancel;
  ASSERT r.reason = 'opted_out', 'opted_out takes precedence over subscription_cancelled';
  DELETE FROM public.survey_reminder_optouts WHERE user_id = u_cancel;

  -- ── RLS, acting as the active student ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_active, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  blocked := false;
  BEGIN
    INSERT INTO public.survey_reminder_optouts (user_id, source, created_by) VALUES (u_cancel, 'self', u_active);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot opt someone else out';

  blocked := false;
  BEGIN
    INSERT INTO public.survey_reminder_optouts (user_id, source, created_by) VALUES (u_active, 'admin', u_active);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot label their opt-out as an admin action';

  INSERT INTO public.survey_reminder_optouts (user_id, source, created_by) VALUES (u_active, 'self', u_active);

  SELECT count(*) INTO n FROM public.survey_reminder_optouts;
  ASSERT n = 1, 'a student sees only their own opt-out row';

  DELETE FROM public.survey_reminder_optouts WHERE user_id = u_optout;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'a student cannot remove someone else''s opt-out';

  blocked := false;
  BEGIN
    UPDATE public.survey_reminder_optouts SET source = 'admin' WHERE user_id = u_active;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'nobody can UPDATE an opt-out row';

  DELETE FROM public.survey_reminder_optouts WHERE user_id = u_active;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'a student can opt back in';

  EXECUTE 'RESET ROLE';

  RAISE NOTICE 'verify-survey-optout: all checks passed';
END
$verify$;

ROLLBACK;
