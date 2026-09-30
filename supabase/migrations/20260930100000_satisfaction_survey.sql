-- Monthly student satisfaction survey (in-portal replacement for the Google Form).
-- Students reach it only through a dedicated link (/encuesta); admins read every
-- response in /admin/surveys.
--
-- Data class: per-user. The student owns their row (insert + read own); only
-- admins/super_admins read everyone's. No secrets. Rows are immutable through the
-- API — nobody may UPDATE or DELETE (no policies for those verbs + privileges revoked).
--
-- One response per student per calendar month. The month ("period") and the
-- timestamp are stamped by the server (Israel time), never trusted from the client.

CREATE TABLE IF NOT EXISTS public.satisfaction_survey_responses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period               date NOT NULL,          -- first day of the month, Asia/Jerusalem
  tenure               text NOT NULL CHECK (tenure IN ('lt_1m', 'gt_1m', 'gt_2m')),
  would_recommend      boolean NOT NULL,
  overall_satisfaction smallint NOT NULL CHECK (overall_satisfaction BETWEEN 1 AND 5),
  needs_improvement    text[] NOT NULL CHECK (
    cardinality(needs_improvement) >= 1
    AND needs_improvement <@ ARRAY['content', 'group', 'ai', 'lives', 'nothing']::text[]
    -- "nothing" is exclusive: it can't be combined with a real improvement area.
    AND (NOT ('nothing' = ANY (needs_improvement)) OR cardinality(needs_improvement) = 1)
  ),
  rating_clarity       smallint NOT NULL CHECK (rating_clarity    BETWEEN 1 AND 4),
  rating_continuity    smallint NOT NULL CHECK (rating_continuity BETWEEN 1 AND 4),
  rating_lives         smallint NOT NULL CHECK (rating_lives      BETWEEN 1 AND 4),
  rating_ai            smallint NOT NULL CHECK (rating_ai         BETWEEN 1 AND 4),
  rating_feedback      smallint NOT NULL CHECK (rating_feedback   BETWEEN 1 AND 4),
  contribution         text NOT NULL CHECK (char_length(btrim(contribution)) BETWEEN 1 AND 5000),
  suggestions          text NOT NULL CHECK (char_length(btrim(suggestions))  BETWEEN 1 AND 5000),
  comments             text CHECK (comments IS NULL OR char_length(comments) <= 5000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period)                     -- once per student per month
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_survey_responses_period
  ON public.satisfaction_survey_responses (period);

-- Server-stamped month + timestamp: a client can't back-date a response or
-- answer "next month" early.
CREATE OR REPLACE FUNCTION public.stamp_satisfaction_survey_response()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  NEW.period := date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem')::date;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_satisfaction_survey_stamp ON public.satisfaction_survey_responses;
CREATE TRIGGER trg_satisfaction_survey_stamp
  BEFORE INSERT ON public.satisfaction_survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.stamp_satisfaction_survey_response();

-- Who may answer: the caller's EFFECTIVE role is student — same resolution the app
-- uses (highest role wins; no user_roles row at all means student). Excludes leads
-- (expired access), staff (their view is a preview), and soft-deleted profiles.
-- Takes no argument on purpose: it only ever reveals the caller's own status.
CREATE OR REPLACE FUNCTION public.is_active_student()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin', 'instructor', 'super_admin')
    )
    AND (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'student')
      OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NOT NULL
    )
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_student() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_student() TO authenticated;

ALTER TABLE public.satisfaction_survey_responses ENABLE ROW LEVEL SECURITY;

-- Read: a student sees only their own responses (to know they already answered
-- this month); admins/super_admins see all. Instructors are deliberately excluded.
DROP POLICY IF EXISTS satisfaction_survey_select ON public.satisfaction_survey_responses;
CREATE POLICY satisfaction_survey_select ON public.satisfaction_survey_responses
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_super_admin(auth.uid())
  );

-- Insert: only your own row, and only as an active student.
DROP POLICY IF EXISTS satisfaction_survey_insert_own ON public.satisfaction_survey_responses;
CREATE POLICY satisfaction_survey_insert_own ON public.satisfaction_survey_responses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_active_student());

-- No UPDATE / DELETE policies: responses are immutable through the API.
-- Belt and braces — also strip the privileges so a future permissive policy
-- can't silently open them.
REVOKE ALL ON public.satisfaction_survey_responses FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.satisfaction_survey_responses FROM authenticated;
