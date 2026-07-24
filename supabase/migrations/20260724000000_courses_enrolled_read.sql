-- Enrolled students must be able to READ the courses they are enrolled in,
-- even when the course is unpublished (a draft).
--
-- Regression context: 20260723000000 enabled RLS on `courses` with a
-- "view published courses" policy (is_published OR admin). But students can be
-- enrolled in unpublished/draft courses (e.g. "Porqué estoy aquí"). For those,
-- the `enrollments.select('*, courses(*)')` embed returned `courses: null`,
-- and the Courses list did `course.title.toLowerCase()` on the spread-of-null
-- row → "Cannot read properties of undefined" → white screen on the Courses tab.
--
-- Fix: an additional permissive SELECT policy (policies are OR'd) so a course is
-- readable when the caller is enrolled in it. Publish state still gates the
-- public catalog (discovery/enrollment); it no longer hides a course from a
-- student who is already enrolled.
-- Idempotent.

DROP POLICY IF EXISTS courses_enrolled_read ON public.courses;
CREATE POLICY courses_enrolled_read ON public.courses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.course_id = courses.id
        AND e.user_id = auth.uid()
    )
  );
