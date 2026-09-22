-- The unlock gate must never take back content a student already has.
--
-- Background
-- ----------
-- 20260603120000 made cross-course gating explicit: a course is locked until
-- every lesson of courses.prerequisite_course_id is complete for that user.
-- The check is stateless — it re-runs on every page load against the CURRENT
-- state of the prerequisite course — and it counts every lesson row.
--
-- Two consequences, both reported from production:
--
--   1. Finished work gets re-locked. A student who completed a course to 100%
--      opens it to review and finds every lesson behind a padlock, because
--      something changed in the course BEFORE it: the catalog was reordered
--      (rebuild_course_prerequisite_chain re-derives the chain from
--      order_index, so the prerequisite can become a different course), a new
--      lesson was added to the prerequisite, or she was enrolled into an
--      earlier course after the fact. She did nothing wrong and the message
--      tells her to "finish the previous course" without naming it.
--
--   2. Hidden lessons make unsatisfiable gates. lessons.is_hidden is filtered
--      out of the student's view of a course but was still counted here, so a
--      hidden lesson in a prerequisite is a lock with no key: she cannot see
--      it, cannot complete it, and everything after it stays shut forever.
--      This is the same class of bug 20260727100000 fixed one level up ("an
--      invisible course must never gate a visible one") — it was still live
--      at the lesson level.
--
-- New rules
-- ---------
--   1. A lesson the user has already completed is ALWAYS unlocked. Re-watching
--      is never gated. This is what makes the gate one-way.
--   2. Only VISIBLE (is_hidden = false) lessons can block anything. If a
--      student can't reach it, it can't be a prerequisite.
--   3. The cross-course gate applies only to a course the user has never
--      started. One completion inside a course proves the gate was open for
--      them once, and it does not close again.
--
-- The within-course sequential rule (lessons_in_order) is unchanged in spirit
-- and still paces a first pass through the material — it just no longer
-- counts hidden lessons or re-locks completed ones.
--
-- src/lib/lessonGating.ts is the client-side mirror of exactly these rules
-- (unit-tested in lessonGating.test.ts). This function stays the enforcement
-- point: lesson_completions_insert_unlocked (20260601100000) checks writes
-- against it.

-- ─── is_lesson_unlocked ──────────────────────────────────────────────
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
  v_module_ord       int;
  v_lesson_ord       int;
  v_lessons_in_order boolean;
  v_prereq_course_id uuid;
  v_started_course   boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role IN ('admin', 'super_admin', 'instructor')
  ) THEN
    RETURN true;
  END IF;

  -- Rule 1: already completed → open forever. Checked before anything else
  -- so no later gate can revoke it.
  IF EXISTS (
    SELECT 1 FROM public.lesson_completions lc
    WHERE lc.lesson_id = p_lesson_id
      AND lc.user_id = p_user_id
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

  -- Within-course gate: every earlier VISIBLE lesson must be completed when
  -- the course is sequential.
  IF v_lessons_in_order THEN
    IF EXISTS (
      SELECT 1
      FROM public.lessons prev_l
      JOIN public.modules prev_m ON prev_m.id = prev_l.module_id
      WHERE prev_m.course_id = v_course_id
        AND COALESCE(prev_l.is_hidden, false) = false
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

  -- Rule 3: has this user done anything at all in this course?
  SELECT EXISTS (
    SELECT 1
    FROM public.lesson_completions lc
    JOIN public.lessons l2  ON l2.id = lc.lesson_id
    JOIN public.modules m2  ON m2.id = l2.module_id
    WHERE m2.course_id = v_course_id
      AND lc.user_id = p_user_id
  ) INTO v_started_course;

  -- Cross-course gate: one explicit prerequisite, enforced only when the user
  -- is enrolled there AND has never started this course.
  IF NOT v_started_course
     AND v_prereq_course_id IS NOT NULL
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
        AND COALESCE(prev_l.is_hidden, false) = false
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

COMMENT ON FUNCTION public.is_lesson_unlocked(uuid, uuid) IS
  'Sequential + cross-course unlock check. One-way: a completed lesson is always unlocked, hidden lessons never block, and the cross-course gate only applies to a course the user has never started.';

-- ─── is_course_unlocked ──────────────────────────────────────────────
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

  -- Not enrolled in the prerequisite → don't gate.
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.user_id = p_user_id
      AND e.course_id = v_prereq_course_id
  ) THEN
    RETURN true;
  END IF;

  -- Rule 3: already inside this course → the gate opened once and stays open.
  IF EXISTS (
    SELECT 1
    FROM public.lesson_completions lc
    JOIN public.lessons l  ON l.id = lc.lesson_id
    JOIN public.modules m  ON m.id = l.module_id
    WHERE m.course_id = p_course_id
      AND lc.user_id = p_user_id
  ) THEN
    RETURN true;
  END IF;

  -- Otherwise: every VISIBLE lesson of the prerequisite must be complete.
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.lessons prev_l
    JOIN public.modules prev_m ON prev_m.id = prev_l.module_id
    WHERE prev_m.course_id = v_prereq_course_id
      AND COALESCE(prev_l.is_hidden, false) = false
      AND NOT EXISTS (
        SELECT 1 FROM public.lesson_completions lc
        WHERE lc.lesson_id = prev_l.id
          AND lc.user_id = p_user_id
      )
  );
END;
$$;

COMMENT ON FUNCTION public.is_course_unlocked(uuid, uuid) IS
  'Cross-course gate. One-way: a course the user has already started is never re-locked, and hidden lessons in the prerequisite never block.';
