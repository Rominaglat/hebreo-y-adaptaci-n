-- Open / community-style courses: opt out of within-course sequential
-- gating. Admin asked that VIVOS-comunidad VIP behave like Hebreo para
-- todos — accessible without prerequisites AND with no fixed lesson
-- order. is_optional already covers the cross-course leg; we add a
-- per-course lessons_in_order flag for the in-course leg.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS lessons_in_order boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.courses.lessons_in_order IS
  'When true (default), lessons inside this course unlock sequentially. When false, every lesson is unlocked the moment the user can access the course — used for community / open / sampler tracks.';

-- Mark the two open courses. Title-based update is intentional — admin
-- can flip the bit via SQL later for any new open course.
UPDATE public.courses
SET lessons_in_order = false
WHERE LOWER(title) = 'hebreo para todos';

UPDATE public.courses
SET lessons_in_order = false,
    is_optional      = true
WHERE LOWER(title) LIKE 'vivos%';

-- ─── Rewrite is_lesson_unlocked to honour both flags ─────────────────
-- A lesson is unlocked iff there is no earlier-in-sequence lesson the
-- user hasn't completed, where "earlier in sequence" now means
-- (cross-course) earlier-ordered non-optional courses the user is
-- enrolled in, OR (within-course) earlier lesson in the SAME course
-- when that course has lessons_in_order = true.
CREATE OR REPLACE FUNCTION public.is_lesson_unlocked(
  p_lesson_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id        uuid;
  v_course_order     int;
  v_module_ord       int;
  v_lesson_ord       int;
  v_lessons_in_order boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  SELECT c.id, c.order_index, m.order_index, l.order_index, c.lessons_in_order
    INTO v_course_id, v_course_order, v_module_ord, v_lesson_ord, v_lessons_in_order
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE l.id = p_lesson_id;

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
    WHERE
      (
        -- Cross-course: an earlier-ordered non-optional enrolled course.
        (
          prev_c.id <> v_course_id
          AND prev_c.order_index < v_course_order
          AND prev_c.is_optional = false
        )
        OR
        -- Within-course: same course, earlier lesson, but ONLY when this
        -- course requires sequential progression.
        (
          prev_c.id = v_course_id
          AND v_lessons_in_order
          AND (prev_m.order_index, prev_l.order_index)
                < (v_module_ord, v_lesson_ord)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id AND lc.user_id = p_user_id
      )
  );
END;
$$;
