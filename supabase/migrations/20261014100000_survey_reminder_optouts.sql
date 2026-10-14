-- Who the monthly survey WhatsApp reminder must NOT go to.
--
-- The reminder (20260930120000_survey_whatsapp_reminder) targets everyone whose
-- effective role is 'student'. Two groups slipped through on its first run
-- (2026-10-14):
--   1. Students who CANCELLED. Cancelling in the customer sheet / Grow does not
--      touch the portal role, so 6 cancelled students got the survey.
--   2. Anyone who asks to stop getting it — there was no way to say so.
--
-- This migration:
--   * adds survey_reminder_optouts — a student can opt themselves out (and back
--     in) from the survey page; an admin can do it for anyone from Manage Users;
--   * re-creates survey_whatsapp_enqueue so both groups are logged as 'skipped'
--     (reason 'opted_out' / 'subscription_cancelled') instead of being messaged.
--     "Cancelled" = the student has rows in student_subscriptions (the synced
--     sheet) and every one of them is cancelled. No sheet row => unchanged.
--
-- Data class of survey_reminder_optouts: per-user. A student reads, adds and
-- removes only their own row (source 'self'); admins / super_admins read and
-- manage every row (source 'admin'). No UPDATE for anyone: opting out and back
-- in is insert / delete.

CREATE TABLE IF NOT EXISTS public.survey_reminder_optouts (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('self', 'admin')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.survey_reminder_optouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS survey_optouts_read ON public.survey_reminder_optouts;
CREATE POLICY survey_optouts_read ON public.survey_reminder_optouts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())
  );

-- A student may only opt THEMSELVES out, labelled as their own choice; an admin
-- may opt anyone out, labelled as an admin action. created_by is always the caller.
DROP POLICY IF EXISTS survey_optouts_insert ON public.survey_reminder_optouts;
CREATE POLICY survey_optouts_insert ON public.survey_reminder_optouts
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      (user_id = auth.uid() AND source = 'self')
      OR (source = 'admin' AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())))
    )
  );

-- Opting back in: the student themselves (even after an admin opted them out at
-- their request — it is their choice), or an admin.
DROP POLICY IF EXISTS survey_optouts_delete ON public.survey_reminder_optouts;
CREATE POLICY survey_optouts_delete ON public.survey_reminder_optouts
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())
  );

REVOKE ALL ON public.survey_reminder_optouts FROM anon;
REVOKE UPDATE, TRUNCATE ON public.survey_reminder_optouts FROM authenticated;

-- ── Enqueue, now skipping opted-out and cancelled students ───────────────────
-- Same as 20260930120000 except for the two `f.*` checks and the reason CASE.
-- Skipped rows keep the month's slot (UNIQUE (period, user_id)), so a student
-- who opts back in mid-month is picked up from next month.
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
      EXISTS (SELECT 1 FROM public.survey_reminder_optouts o WHERE o.user_id = pr.id) AS opted_out,
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
