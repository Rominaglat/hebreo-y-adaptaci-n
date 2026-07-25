-- Voice feedback on assignment submissions: staff can attach a recorded audio
-- reply next to the text feedback (played by the student inside the lesson).
--
-- Data classification: feedback_audio_path is per-user data — an object path
-- in the private 'assignment-audio' bucket, stored under the STUDENT's prefix
-- ({studentId}/{lessonId}/feedback.webm) so the existing owner-read storage
-- policy already lets the student play it. Read: owner + staff (existing table
-- SELECT policy). Write: staff only (guard triggers below). No secret columns.

ALTER TABLE public.assignment_submissions
  ADD COLUMN IF NOT EXISTS feedback_audio_path text;

-- UPDATE guard, extended:
--  * also protects the new feedback_audio_path column;
--  * EXCEPT it now lets the owner flip status 'reviewed' -> 'submitted' (and
--    nothing else). Without this carve-out a student who resubmits after
--    review is rejected outright (the app upserts status='submitted'), and a
--    resubmission must re-enter the review queue anyway.
CREATE OR REPLACE FUNCTION public.guard_assignment_feedback()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_or_instructor(auth.uid()) THEN
    IF NEW.feedback_text IS DISTINCT FROM OLD.feedback_text
       OR NEW.feedback_by IS DISTINCT FROM OLD.feedback_by
       OR NEW.feedback_at IS DISTINCT FROM OLD.feedback_at
       OR NEW.feedback_audio_path IS DISTINCT FROM OLD.feedback_audio_path
       OR (NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status = 'reviewed' AND NEW.status = 'submitted')) THEN
      RAISE EXCEPTION 'only staff may set feedback/status';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- INSERT guard — gap in the original migration: the guard only fired on
-- UPDATE, so a student could INSERT their first row pre-marked
-- status='reviewed' with self-written "teacher feedback", which would also
-- hide it from the review queue. auth.uid() IS NULL (service_role) stays
-- exempt, matching RLS-bypass semantics for trusted backend jobs.
CREATE OR REPLACE FUNCTION public.guard_assignment_feedback_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_or_instructor(auth.uid()) THEN
    IF NEW.feedback_text IS NOT NULL
       OR NEW.feedback_by IS NOT NULL
       OR NEW.feedback_at IS NOT NULL
       OR NEW.feedback_audio_path IS NOT NULL
       OR NEW.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION 'only staff may set feedback/status';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assignment_feedback_guard_ins ON public.assignment_submissions;
CREATE TRIGGER trg_assignment_feedback_guard_ins
  BEFORE INSERT ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_feedback_insert();

-- Storage: staff may write ONLY feedback objects ('.../feedback.webm') in the
-- assignment-audio bucket — least-privilege, so a (compromised) staff session
-- still can't overwrite a student's answer recordings. Both INSERT and UPDATE
-- are needed because the client uploads with upsert=true.
-- (Students keep write access to their own prefix, which includes the feedback
-- file; worst case a student overwrites audio addressed to themselves.)
DROP POLICY IF EXISTS "assignment_audio_staff_feedback_insert" ON storage.objects;
CREATE POLICY "assignment_audio_staff_feedback_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'assignment-audio'
    AND public.is_admin_or_instructor(auth.uid())
    AND name LIKE '%/feedback.webm'
  );

DROP POLICY IF EXISTS "assignment_audio_staff_feedback_update" ON storage.objects;
CREATE POLICY "assignment_audio_staff_feedback_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'assignment-audio'
    AND public.is_admin_or_instructor(auth.uid())
    AND name LIKE '%/feedback.webm'
  )
  WITH CHECK (
    bucket_id = 'assignment-audio'
    AND public.is_admin_or_instructor(auth.uid())
    AND name LIKE '%/feedback.webm'
  );
