-- Explicit per-course prerequisite + admin UI rebuild.
--
-- Previously cross-course gating was inferred lexicographically from
-- (course.order_index, module.order_index, lesson.order_index) and the
-- is_optional flag was used to skip "open" courses. That was implicit
-- magic from the admin's perspective. The admin asked for an explicit
-- "this course follows that course" dropdown in the edit screen.
--
-- New model:
--   * courses.prerequisite_course_id (uuid, nullable, FK to courses.id):
--     when set, this course's lessons are gated until every lesson in
--     the referenced course is complete by the same user — and only
--     when the user is also enrolled in that prerequisite.
--   * lessons_in_order (existing): controls in-course sequential gating.
--   * is_optional (existing): kept around for legacy reads and admin
--     metadata; the new SQL no longer consults it for unlock decisions
--     (the prerequisite_course_id is the source of truth now).
--
-- Backfill matches the current behavior: for every non-optional course
-- with an order_index, set its prerequisite to the immediately preceding
-- non-optional course (so Fundamentos → null, Comunicación → Fundamentos,
-- etc.).

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS prerequisite_course_id uuid
    REFERENCES public.courses(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.courses.prerequisite_course_id IS
  'When set, this course is gated until the user (if also enrolled in the prerequisite) completes every lesson there. NULL = standalone.';

-- Backfill — chain non-optional courses by order_index. Each course
-- inherits the previous non-optional course as its prerequisite. Optional
-- courses (Hebreo para todos, VIVOS) stay with prerequisite_course_id
-- NULL so they don''t gate or get gated.
WITH chained AS (
  SELECT id,
         LAG(id) OVER (ORDER BY order_index) AS prev_id
  FROM public.courses
  WHERE order_index IS NOT NULL AND is_optional = false
)
UPDATE public.courses c
SET prerequisite_course_id = chained.prev_id
FROM chained
WHERE c.id = chained.id
  AND chained.prev_id IS NOT NULL
  AND c.prerequisite_course_id IS NULL;

-- ─── Rewrite is_lesson_unlocked around explicit prerequisite ─────────
CREATE OR REPLACE FUNCTION public.is_lesson_unlocked(
  p_lesson_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id           uuid;
  v_module_ord          int;
  v_lesson_ord          int;
  v_lessons_in_order    boolean;
  v_prereq_course_id    uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  SELECT c.id, m.order_index, l.order_index, c.lessons_in_order, c.prerequisite_course_id
    INTO v_course_id, v_module_ord, v_lesson_ord, v_lessons_in_order, v_prereq_course_id
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE l.id = p_lesson_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Within-course gate: every earlier (module, lesson) in the SAME
  -- course must be completed when the course is sequential.
  IF v_lessons_in_order THEN
    IF EXISTS (
      SELECT 1
      FROM public.lessons prev_l
      JOIN public.modules prev_m ON prev_m.id = prev_l.module_id
      WHERE prev_m.course_id = v_course_id
        AND (prev_m.order_index, prev_l.order_index)
              < (v_module_ord, v_lesson_ord)
        AND NOT EXISTS (
          SELECT 1 FROM public.lesson_completions lc
          WHERE lc.lesson_id = prev_l.id
            AND lc.user_id = p_user_id
        )
    ) THEN
      RETURN false;
    END IF;
  END IF;

  -- Cross-course gate: a single explicit prerequisite course, enforced
  -- only when the user is also enrolled there (so a user who only owns
  -- the later course isn''t permanently locked out).
  IF v_prereq_course_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.enrollments e
       WHERE e.user_id = p_user_id
         AND e.course_id = v_prereq_course_id
     )
  THEN
    IF EXISTS (
      SELECT 1
      FROM public.lessons prev_l
      JOIN public.modules prev_m ON prev_m.id = prev_l.module_id
      WHERE prev_m.course_id = v_prereq_course_id
        AND NOT EXISTS (
          SELECT 1 FROM public.lesson_completions lc
          WHERE lc.lesson_id = prev_l.id
            AND lc.user_id = p_user_id
        )
    ) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

-- ─── is_course_unlocked: same logic, no lesson position needed ───────
CREATE OR REPLACE FUNCTION public.is_course_unlocked(
  p_course_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prereq_course_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  SELECT prerequisite_course_id INTO v_prereq_course_id
  FROM public.courses
  WHERE id = p_course_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_prereq_course_id IS NULL THEN
    RETURN true;
  END IF;

  -- Not enrolled in the prerequisite → don''t gate.
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.user_id = p_user_id
      AND e.course_id = v_prereq_course_id
  ) THEN
    RETURN true;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.lessons prev_l
    JOIN public.modules prev_m ON prev_m.id = prev_l.module_id
    WHERE prev_m.course_id = v_prereq_course_id
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id
          AND lc.user_id = p_user_id
      )
  );
END;
$$;
