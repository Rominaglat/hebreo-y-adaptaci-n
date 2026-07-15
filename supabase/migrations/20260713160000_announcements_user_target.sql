-- Personal announcements: an announcement may target a SINGLE user (e.g. teacher
-- feedback on an assignment). Adds announcements.user_id and extends the SELECT
-- policy so a user sees announcements addressed personally to them — while
-- preserving global (course_id + user_id both NULL) and course-scoped behaviour.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_announcements_user ON public.announcements(user_id);

DROP POLICY IF EXISTS "Authenticated users can view announcements" ON public.announcements;
CREATE POLICY "Authenticated users can view announcements" ON public.announcements
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      (course_id IS NULL AND user_id IS NULL)            -- global announcement
      OR user_id = auth.uid()                            -- personal announcement
      OR public.is_admin_or_instructor(auth.uid())
      OR (course_id IS NOT NULL AND EXISTS (             -- course-scoped: enrolled only
        SELECT 1 FROM public.enrollments e
        WHERE e.course_id = announcements.course_id
          AND e.user_id = auth.uid()
      ))
    )
  );
