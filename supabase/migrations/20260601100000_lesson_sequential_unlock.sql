-- Sequential lesson unlock: each lesson is gated by completion of the
-- previous one in the course (ordered by module.order_index then
-- lesson.order_index). The first lesson of a course is always unlocked.
--
-- Admin / super_admin / instructor roles bypass the gate entirely.
--
-- Client-side UI uses this to render lock icons and block clicks.
-- The RLS policy below also enforces it server-side on completion writes:
-- a user cannot mark a lesson complete unless they have access to it,
-- which prevents tampering through direct API calls.

-- ─── Helper: is a given lesson unlocked for a given user? ────────────────────
CREATE OR REPLACE FUNCTION public.is_lesson_unlocked(
  p_lesson_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id   uuid;
  v_module_ord  int;
  v_lesson_ord  int;
BEGIN
  -- Admin / super_admin / instructor see every lesson as unlocked.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  -- Locate the lesson in its course.
  SELECT m.course_id, m.order_index, l.order_index
    INTO v_course_id, v_module_ord, v_lesson_ord
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE l.id = p_lesson_id;

  -- Unknown lesson → deny by default.
  IF v_course_id IS NULL THEN
    RETURN false;
  END IF;

  -- Unlocked iff there is no earlier lesson (by module, then lesson order)
  -- in the same course that the user has not yet completed.
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.lessons prev
    JOIN public.modules pm ON pm.id = prev.module_id
    WHERE pm.course_id = v_course_id
      AND (pm.order_index, prev.order_index) < (v_module_ord, v_lesson_ord)
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev.id AND lc.user_id = p_user_id
      )
  );
END;
$$;

COMMENT ON FUNCTION public.is_lesson_unlocked(uuid, uuid) IS
  'True iff the user can access the given lesson under the sequential-unlock rule. Admins/instructors always pass.';

GRANT EXECUTE ON FUNCTION public.is_lesson_unlocked(uuid, uuid) TO authenticated;

-- ─── Server-side enforcement on lesson_completions ──────────────────────────
-- Enable RLS (no-op if already on) and rewrite the policies so that:
--   * users can SELECT/DELETE their own completion rows (needed for the
--     existing "mark incomplete" / progress queries on the client),
--   * users can INSERT a completion ONLY for a lesson that is currently
--     unlocked for them (the integrity check that blocks tampering via
--     direct API calls or devtools).
-- Admins/instructors are covered by is_lesson_unlocked() which short-
-- circuits to true for those roles.
ALTER TABLE public.lesson_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lesson_completions_select_own ON public.lesson_completions;
CREATE POLICY lesson_completions_select_own
  ON public.lesson_completions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.user_roles
           WHERE user_id = auth.uid()
             AND role IN ('admin', 'super_admin', 'instructor')
         ));

DROP POLICY IF EXISTS lesson_completions_delete_own ON public.lesson_completions;
CREATE POLICY lesson_completions_delete_own
  ON public.lesson_completions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS lesson_completions_insert_unlocked ON public.lesson_completions;
CREATE POLICY lesson_completions_insert_unlocked
  ON public.lesson_completions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_lesson_unlocked(lesson_id, auth.uid())
  );
