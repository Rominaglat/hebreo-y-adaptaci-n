-- Course-scoped announcements: an announcement may target a single course, in
-- which case only students enrolled in that course (plus staff) see it in the
-- portal feed. course_id NULL = global announcement (unchanged behaviour).
-- The SELECT policy does the filtering centrally, so no client query changes.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_announcements_course ON public.announcements(course_id);

DROP POLICY IF EXISTS "Authenticated users can view announcements" ON public.announcements;
CREATE POLICY "Authenticated users can view announcements" ON public.announcements
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      course_id IS NULL
      OR public.is_admin_or_instructor(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = announcements.course_id
          AND e.user_id = auth.uid()
      )
    )
  );
