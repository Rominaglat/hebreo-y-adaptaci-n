-- One do-not-contact list for every message the portal sends.
--
-- Someone who asks to be removed must stop hearing from us everywhere: the
-- survey WhatsApp, the lifecycle / weekly-goal / new-content / feedback emails,
-- push notifications, and the outside WhatsApp automation that reads the
-- portal through external-api. Until now each channel had its own opt-out (or
-- none), so a removal request reached at most one of them.
--
-- An entry names a person by any of: portal account, phone, email — so people
-- who are not in the portal (leads that only exist in the WhatsApp automation)
-- can be listed too. A person is suppressed when ANY entry matches their
-- account, their profile phone (last 9 digits) or their profile email.
--
-- Not covered on purpose: messages the person triggers themselves (password
-- reset, account invite) — blocking those would lock them out, and they are
-- not outreach.
--
-- Replaces survey_reminder_optouts (20261014100000); its rows are carried over.
--
-- Data class: role-gated PII (phones / emails, also of non-users). Admins read
-- and manage every row; a student reads, adds and removes only their own
-- account-level row. The send paths read the list through SECURITY DEFINER
-- functions callable by service_role only.

-- ── Phone key: last 9 digits, the same rung phone-match.ts matches on first ──
CREATE OR REPLACE FUNCTION public.contact_phone_key(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(raw, ''), '\D', '', 'g')) < 8 THEN NULL
    ELSE right(regexp_replace(raw, '\D', '', 'g'), 9)
  END
$$;

-- ── The list ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_suppressions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  phone      text,
  phone_key  text GENERATED ALWAYS AS (public.contact_phone_key(phone)) STORED,
  email      text,
  email_key  text GENERATED ALWAYS AS (nullif(lower(btrim(email)), '')) STORED,
  reason     text,
  source     text NOT NULL CHECK (source IN ('self', 'admin', 'api')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_suppressions_identifies_someone
    CHECK (user_id IS NOT NULL OR phone_key IS NOT NULL OR email_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_user_uq  ON public.contact_suppressions (user_id)   WHERE user_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_phone_uq ON public.contact_suppressions (phone_key) WHERE phone_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contact_suppressions_email_uq ON public.contact_suppressions (email_key) WHERE email_key IS NOT NULL;

ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_suppressions_read ON public.contact_suppressions;
CREATE POLICY contact_suppressions_read ON public.contact_suppressions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())
  );

-- A student may list only THEMSELVES (by account, nothing else, labelled as
-- their own choice); an admin may list anyone, by account, phone or email.
-- created_by is always the caller. The API path writes as service_role.
DROP POLICY IF EXISTS contact_suppressions_insert ON public.contact_suppressions;
CREATE POLICY contact_suppressions_insert ON public.contact_suppressions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      (source = 'self' AND user_id = auth.uid() AND phone IS NULL AND email IS NULL)
      OR (source = 'admin' AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())))
    )
  );

-- Back in: the student removes their own account-level row (even one an admin
-- added at their request — it is their choice); admins remove any row.
DROP POLICY IF EXISTS contact_suppressions_delete ON public.contact_suppressions;
CREATE POLICY contact_suppressions_delete ON public.contact_suppressions
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())
  );

REVOKE ALL ON public.contact_suppressions FROM anon;
REVOKE UPDATE, TRUNCATE ON public.contact_suppressions FROM authenticated;

-- ── Lookups for the send paths (service_role only) ──────────────────────────
-- Is this person on the list — by account, by the phone / email given, or by
-- the phone / email on their profile?
CREATE OR REPLACE FUNCTION public.is_contact_suppressed(_user_id uuid, _phone text DEFAULT NULL, _email text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH who AS (
    SELECT public.contact_phone_key(_phone)          AS phone_key,
           public.contact_phone_key(p.phone)         AS profile_phone_key,
           nullif(lower(btrim(_email)), '')          AS email_key,
           nullif(lower(btrim(p.email)), '')         AS profile_email_key
    FROM (SELECT 1) one
    LEFT JOIN public.profiles p ON p.id = _user_id
  )
  SELECT EXISTS (
    SELECT 1 FROM public.contact_suppressions s, who
    WHERE (_user_id IS NOT NULL AND s.user_id = _user_id)
       OR (s.phone_key IS NOT NULL AND s.phone_key IN (who.phone_key, who.profile_phone_key))
       OR (s.email_key IS NOT NULL AND s.email_key IN (who.email_key, who.profile_email_key))
  )
$$;

-- Every portal account the list covers — for the bulk senders.
CREATE OR REPLACE FUNCTION public.suppressed_user_ids()
RETURNS TABLE (user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1 FROM public.contact_suppressions s
    WHERE s.user_id = p.id
       OR (s.phone_key IS NOT NULL AND s.phone_key = public.contact_phone_key(p.phone))
       OR (s.email_key IS NOT NULL AND s.email_key = nullif(lower(btrim(p.email)), ''))
  )
$$;

-- Students whose every subscription row in the synced customer sheet is
-- cancelled: no "we miss you" / reminder outreach to people who left.
CREATE OR REPLACE FUNCTION public.subscription_cancelled_user_ids()
RETURNS TABLE (user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ss.user_id
  FROM public.student_subscriptions ss
  WHERE ss.user_id IS NOT NULL
  GROUP BY ss.user_id
  HAVING bool_and(ss.status = 'cancelled')
$$;

REVOKE EXECUTE ON FUNCTION public.is_contact_suppressed(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.suppressed_user_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.subscription_cancelled_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_contact_suppressed(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.suppressed_user_ids() TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_cancelled_user_ids() TO service_role;

-- ── Carry over yesterday's survey opt-outs, then retire that table ──────────
INSERT INTO public.contact_suppressions (user_id, source, created_by, created_at, reason)
SELECT o.user_id, o.source, o.created_by, o.created_at, 'survey opt-out'
FROM public.survey_reminder_optouts o
ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO NOTHING;

-- ── Survey reminder: skip anyone on the list (was: survey_reminder_optouts) ──
-- Same as 20261014100000 except the opted_out check.
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
         CASE WHEN x.reason IS NULL THEN 'queued' ELSE 'skipped' END,
         x.reason
  FROM public.profiles pr
  JOIN auth.users u ON u.id = pr.id
  CROSS JOIN LATERAL (SELECT public.normalize_phone_intl(pr.phone) AS phone) ph
  CROSS JOIN LATERAL (
    SELECT
      public.is_contact_suppressed(pr.id) AS opted_out,
      EXISTS (SELECT 1 FROM public.student_subscriptions ss WHERE ss.user_id = pr.id)
        AND NOT EXISTS (SELECT 1 FROM public.student_subscriptions ss
                        WHERE ss.user_id = pr.id AND ss.status <> 'cancelled') AS cancelled
  ) f
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN f.opted_out                          THEN 'opted_out'
      WHEN f.cancelled                          THEN 'subscription_cancelled'
      WHEN coalesce(btrim(pr.phone), '') = ''   THEN 'no_phone'
      WHEN ph.phone IS NULL                     THEN 'invalid_phone'
    END AS reason
  ) x
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

REVOKE EXECUTE ON FUNCTION public.survey_whatsapp_enqueue(boolean) FROM PUBLIC, anon, authenticated;

DROP TABLE IF EXISTS public.survey_reminder_optouts;
