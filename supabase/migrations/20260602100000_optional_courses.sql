-- Course-level UX cleanup + Hebreo Gratis exemption.
--
-- Two changes the user asked for:
--   1. Courses are always enterable (the course-level "locked because
--      previous course isn't done" banner / card is being removed in the
--      UI). Lessons inside still gate sequentially.
--   2. The free intro course "Hebreo Gratis" should not count as a
--      prerequisite for anything. We model this with a new
--      courses.is_optional flag — set true for the free intro, false
--      for paid courses by default. is_lesson_unlocked() now skips any
--      optional course when scanning earlier-in-sequence lessons.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.courses.is_optional IS
  'When true, this course is not treated as a prerequisite for later-ordered courses. Used for free intros / sampler tracks.';

-- Flag the free intro. Title match is intentional — the admin UI can
-- always toggle the bit by hand for other future free courses.
UPDATE public.courses
SET is_optional = true
WHERE LOWER(title) = 'hebreo gratis';

-- ─── Rewrite is_lesson_unlocked to skip optional courses ─────────────
-- Body is otherwise the same as 20260601120000: cross-course lexicographic
-- check, scoped to enrolled courses. The only new clause is
-- `prev_c.is_optional = false`.
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
      AND prev_c.is_optional = false                       -- ← NEW
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id AND lc.user_id = p_user_id
      )
  );
END;
$$;

-- Same exemption inside is_course_unlocked (used to be referenced from
-- the now-removed course banner; harmless to keep updated in case any
-- caller still uses it).
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
      AND prev_c.is_optional = false                       -- ← NEW
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id AND lc.user_id = p_user_id
      )
  );
END;
$$;
