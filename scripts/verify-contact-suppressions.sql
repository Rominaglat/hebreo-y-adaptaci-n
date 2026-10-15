-- scripts/verify-contact-suppressions.sql — behavioural proof for the
-- do-not-contact list (20261015100000_contact_suppressions).
--
-- Applies the migration inside a transaction, exercises it against real
-- students picked from the live data, and ROLLS BACK. Nothing is kept: the
-- list entries and this month's re-enqueued survey rows exist only inside the
-- transaction (pg_cron cannot see them), profiles are only read, and the
-- migration itself — including the DROP of survey_reminder_optouts — is undone.
--
-- Run from the repo root:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-contact-suppressions.sql
--
-- Every check is an ASSERT: silent on success, aborts with the rule's name otherwise.

BEGIN;

\i supabase/migrations/20261015100000_contact_suppressions.sql

DO $verify$
DECLARE
  p        date := date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')::date;
  u_phone  uuid;  -- active student, listed by PHONE (written differently)
  u_email  uuid;  -- active student, listed by EMAIL (different case / spaces)
  u_self   uuid;  -- active student who lists themselves
  u_free   uuid;  -- active student nobody listed
  u_cancel uuid;  -- student whose every sheet row is cancelled
  ph       text;
  em       text;
  r        record;
  n        integer;
  blocked  boolean;
BEGIN
  ASSERT public.contact_phone_key('053-344-4352') = '533444352', 'phone key: local format';
  ASSERT public.contact_phone_key('+972 53 344 4352') = '533444352', 'phone key: international format';
  ASSERT public.contact_phone_key('12345') IS NULL, 'phone key: too short is no key';
  ASSERT to_regclass('public.survey_reminder_optouts') IS NULL, 'survey_reminder_optouts is retired';

  -- ── Fixtures: real students (reads only) ──
  CREATE TEMP TABLE eligible ON COMMIT DROP AS
    SELECT pr.id, pr.phone, pr.email FROM public.profiles pr
    WHERE pr.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = pr.id AND x.role = 'student')
      AND NOT EXISTS (SELECT 1 FROM public.user_roles x
                      WHERE x.user_id = pr.id AND x.role IN ('admin', 'instructor', 'super_admin'))
      AND NOT EXISTS (SELECT 1 FROM public.satisfaction_survey_responses s WHERE s.user_id = pr.id AND s.period = p)
      AND public.normalize_phone_intl(pr.phone) IS NOT NULL
      AND public.contact_phone_key(pr.phone) IS NOT NULL
      AND nullif(btrim(pr.email), '') IS NOT NULL;
  -- Students whose phone / email key is unique, so one entry can't hit two people.
  DELETE FROM eligible e WHERE EXISTS (
    SELECT 1 FROM public.profiles o WHERE o.id <> e.id
      AND (public.contact_phone_key(o.phone) = public.contact_phone_key(e.phone)
           OR lower(btrim(o.email)) = lower(btrim(e.email))));

  SELECT id INTO u_phone  FROM eligible e WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status = 'active') ORDER BY id LIMIT 1;
  SELECT id INTO u_email  FROM eligible e WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status = 'active') ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO u_self   FROM eligible e WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status = 'active') ORDER BY id OFFSET 2 LIMIT 1;
  SELECT id INTO u_free   FROM eligible e WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status = 'active') ORDER BY id OFFSET 3 LIMIT 1;
  SELECT id INTO u_cancel FROM eligible e WHERE EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = e.id AND ss.status <> 'cancelled') ORDER BY id LIMIT 1;
  ASSERT u_phone IS NOT NULL AND u_email IS NOT NULL AND u_self IS NOT NULL AND u_free IS NOT NULL AND u_cancel IS NOT NULL,
    'fixtures: need four active and one cancelled student with unique phone/email';
  -- The list must not already cover them.
  ASSERT NOT public.is_contact_suppressed(u_phone) AND NOT public.is_contact_suppressed(u_email)
     AND NOT public.is_contact_suppressed(u_self) AND NOT public.is_contact_suppressed(u_free),
    'fixtures are not on the list yet';

  -- ── Matching ──
  SELECT '+972 ' || public.contact_phone_key(phone) INTO ph FROM public.profiles WHERE id = u_phone;  -- same number, other format
  SELECT '  ' || upper(email) || ' ' INTO em FROM public.profiles WHERE id = u_email;                  -- same address, other case
  INSERT INTO public.contact_suppressions (phone, source, reason) VALUES (ph, 'admin', 'verify');
  INSERT INTO public.contact_suppressions (email, source, reason) VALUES (em, 'admin', 'verify');

  ASSERT public.is_contact_suppressed(u_phone), 'a phone entry covers the account with that phone';
  ASSERT public.is_contact_suppressed(NULL, (SELECT phone FROM public.profiles WHERE id = u_phone)),
    'a phone entry answers a lookup by phone alone (the outside automation)';
  ASSERT public.is_contact_suppressed(u_email), 'an email entry covers the account with that email';
  ASSERT NOT public.is_contact_suppressed(u_free), 'nobody else is covered';
  ASSERT (SELECT count(*) FROM public.suppressed_user_ids() s WHERE s.user_id IN (u_phone, u_email)) = 2,
    'suppressed_user_ids lists both';
  ASSERT NOT EXISTS (SELECT 1 FROM public.suppressed_user_ids() s WHERE s.user_id = u_free),
    'suppressed_user_ids leaves the rest out';

  blocked := false;
  BEGIN
    INSERT INTO public.contact_suppressions (phone, source) VALUES (ph || ' ', 'admin');
  EXCEPTION WHEN unique_violation THEN blocked := true;
  END;
  ASSERT blocked, 'the same phone cannot be listed twice, whatever its formatting';

  ASSERT EXISTS (SELECT 1 FROM public.subscription_cancelled_user_ids() c WHERE c.user_id = u_cancel),
    'subscription_cancelled_user_ids lists the cancelled student';
  ASSERT NOT EXISTS (SELECT 1 FROM public.subscription_cancelled_user_ids() c WHERE c.user_id = u_free),
    'subscription_cancelled_user_ids leaves an active student out';

  -- ── Survey enqueue honours the list ──
  DELETE FROM public.survey_whatsapp_sends WHERE period = p AND user_id IN (u_phone, u_email, u_free, u_cancel);
  PERFORM public.survey_whatsapp_enqueue(true);
  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_phone;
  ASSERT r.status = 'skipped' AND r.reason = 'opted_out', 'survey: listed by phone => skipped opted_out';
  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_email;
  ASSERT r.status = 'skipped' AND r.reason = 'opted_out', 'survey: listed by email => skipped opted_out';
  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_free;
  ASSERT r.status = 'queued', 'survey: everyone else still queued';
  SELECT status, reason INTO r FROM public.survey_whatsapp_sends WHERE period = p AND user_id = u_cancel;
  ASSERT r.reason = 'subscription_cancelled', 'survey: cancelled still skipped';

  -- ── RLS, acting as u_self ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_self, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  blocked := false;
  BEGIN
    INSERT INTO public.contact_suppressions (user_id, source, created_by) VALUES (u_free, 'self', u_self);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot list someone else';

  blocked := false;
  BEGIN
    INSERT INTO public.contact_suppressions (phone, source, created_by) VALUES ('0501112233', 'self', u_self);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot list an arbitrary phone';

  blocked := false;
  BEGIN
    INSERT INTO public.contact_suppressions (user_id, source, created_by) VALUES (u_self, 'admin', u_self);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot label their entry as an admin action';

  INSERT INTO public.contact_suppressions (user_id, source, created_by) VALUES (u_self, 'self', u_self);

  SELECT count(*) INTO n FROM public.contact_suppressions;
  ASSERT n = 1, 'a student sees only their own entry (not the phone / email entries)';

  DELETE FROM public.contact_suppressions WHERE user_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'a student cannot remove other entries';

  blocked := false;
  BEGIN
    UPDATE public.contact_suppressions SET reason = 'x' WHERE user_id = u_self;
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'nobody can UPDATE an entry';

  blocked := false;
  BEGIN
    PERFORM public.suppressed_user_ids();
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'students cannot call the bulk lookup';

  DELETE FROM public.contact_suppressions WHERE user_id = u_self;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'a student can take themselves off the list';

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'verify-contact-suppressions: all checks passed';
END
$verify$;

ROLLBACK;
