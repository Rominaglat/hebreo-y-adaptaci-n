-- "Submission assignment" lesson type (lesson_type='assignment'; prompt stored in
-- lessons.content_text — no lessons DDL needed since lesson_type is free TEXT).
-- Students answer with free text + an optional voice recording; staff give text feedback.

CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer_text  text,
  audio_path   text,                          -- object path in the private 'assignment-audio' bucket
  status       text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewed')),
  feedback_text text,
  feedback_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feedback_at  timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, user_id)                  -- one submission per student per assignment
);

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_lesson ON public.assignment_submissions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_assignment_submissions_user   ON public.assignment_submissions(user_id);

CREATE OR REPLACE FUNCTION public.touch_assignment_submissions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_assignment_submissions_touch ON public.assignment_submissions;
CREATE TRIGGER trg_assignment_submissions_touch
  BEFORE UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_assignment_submissions_updated_at();

-- Guard: a non-staff actor may never change the feedback/status columns.
CREATE OR REPLACE FUNCTION public.guard_assignment_feedback()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_or_instructor(auth.uid()) THEN
    IF NEW.feedback_text IS DISTINCT FROM OLD.feedback_text
       OR NEW.feedback_by IS DISTINCT FROM OLD.feedback_by
       OR NEW.feedback_at IS DISTINCT FROM OLD.feedback_at
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'only staff may set feedback/status';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assignment_feedback_guard ON public.assignment_submissions;
CREATE TRIGGER trg_assignment_feedback_guard
  BEFORE UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_feedback();

ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_submissions_select ON public.assignment_submissions;
CREATE POLICY assignment_submissions_select ON public.assignment_submissions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin_or_instructor(auth.uid()));

DROP POLICY IF EXISTS assignment_submissions_insert_own ON public.assignment_submissions;
CREATE POLICY assignment_submissions_insert_own ON public.assignment_submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Owner may edit their own submission (feedback columns are blocked by the guard trigger);
-- staff may edit any (to write feedback).
DROP POLICY IF EXISTS assignment_submissions_update ON public.assignment_submissions;
CREATE POLICY assignment_submissions_update ON public.assignment_submissions
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin_or_instructor(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_or_instructor(auth.uid()));

DROP POLICY IF EXISTS assignment_submissions_delete_own ON public.assignment_submissions;
CREATE POLICY assignment_submissions_delete_own ON public.assignment_submissions
  FOR DELETE USING (auth.uid() = user_id OR public.is_admin_or_instructor(auth.uid()));

-- Private bucket for the voice recordings; students own the "<their-uid>/..." prefix.
INSERT INTO storage.buckets (id, name, public)
VALUES ('assignment-audio', 'assignment-audio', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "assignment_audio_owner_read" ON storage.objects;
CREATE POLICY "assignment_audio_owner_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'assignment-audio'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin_or_instructor(auth.uid())
    )
  );

DROP POLICY IF EXISTS "assignment_audio_owner_insert" ON storage.objects;
CREATE POLICY "assignment_audio_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'assignment-audio'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "assignment_audio_owner_update" ON storage.objects;
CREATE POLICY "assignment_audio_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'assignment-audio'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "assignment_audio_owner_or_staff_delete" ON storage.objects;
CREATE POLICY "assignment_audio_owner_or_staff_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'assignment-audio'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin_or_instructor(auth.uid())
    )
  );
