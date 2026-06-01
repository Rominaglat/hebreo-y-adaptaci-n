-- Cross-course sequential gating.
--
-- Extends the per-course rule shipped in 20260601100000: the unlock
-- sequence now spans the whole catalog. A lesson is unlocked iff every
-- earlier-in-sequence lesson — measured lexicographically on the tuple
-- (course.order_index, module.order_index, lesson.order_index), across
-- courses the user is enrolled in — has been completed.
--
-- Practical consequence: the FIRST lesson of course N (N >= 2) is now
-- locked until the LAST lesson of course N-1 is marked complete (since
-- "every earlier lesson in earlier courses" naturally collapses to that).
--
-- Admin / super_admin / instructor still bypass.

CREATE OR REPLACE FUNCTION public.is_lesson_unlocked(
  p_lesson_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_order int;
  v_module_ord   int;
  v_lesson_ord   int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  SELECT c.order_index, m.order_index, l.order_index
    INTO v_course_order, v_module_ord, v_lesson_ord
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE l.id = p_lesson_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Earlier-in-sequence = lexicographically smaller (course, module, lesson)
  -- order tuple, scoped to courses the user is enrolled in (so a paywalled
  -- course they don't own doesn't permanently lock them out of later ones).
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.lessons prev_l
    JOIN public.modules  prev_m ON prev_m.id = prev_l.module_id
    JOIN public.courses  prev_c ON prev_c.id = prev_m.course_id
    JOIN public.enrollments prev_e
      ON prev_e.course_id = prev_c.id AND prev_e.user_id = p_user_id
    WHERE
      (prev_c.order_index, prev_m.order_index, prev_l.order_index)
        < (v_course_order, v_module_ord, v_lesson_ord)
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id AND lc.user_id = p_user_id
      )
  );
END;
$$;

COMMENT ON FUNCTION public.is_lesson_unlocked(uuid, uuid) IS
  'True iff the user can access the given lesson under the cross-course sequential-unlock rule. Admins/instructors always pass.';

-- ─── Convenience helper for the client: is the user allowed to START
--     this course at all? True iff every earlier-ordered enrolled course
--     is fully complete. Mirrors the "first lesson of next course" gate.
CREATE OR REPLACE FUNCTION public.is_course_unlocked(
  p_course_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_order int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  SELECT order_index INTO v_course_order
  FROM public.courses
  WHERE id = p_course_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.lessons prev_l
    JOIN public.modules  prev_m ON prev_m.id = prev_l.module_id
    JOIN public.courses  prev_c ON prev_c.id = prev_m.course_id
    JOIN public.enrollments prev_e
      ON prev_e.course_id = prev_c.id AND prev_e.user_id = p_user_id
    WHERE prev_c.order_index < v_course_order
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id AND lc.user_id = p_user_id
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_course_unlocked(uuid, uuid) TO authenticated;

-- ─── One-shot listing for the Courses page: returns the lock state of
--     every course for the caller in a single round-trip.
CREATE OR REPLACE FUNCTION public.my_course_lock_states()
RETURNS TABLE(course_id uuid, is_unlocked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c.id, public.is_course_unlocked(c.id, auth.uid())
    FROM public.courses c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_course_lock_states() TO authenticated;
