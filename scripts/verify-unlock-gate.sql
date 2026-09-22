-- scripts/verify-unlock-gate.sql — behavioural proof for the one-way unlock gate.
--
-- Applies 20260922100000_gate_never_relocks_finished_work.sql, exercises it
-- against synthetic fixtures, and ROLLS BACK. Nothing is kept: the fixtures
-- live only inside this transaction, and no auth.* table is touched
-- (lesson_completions.user_id / enrollments.user_id are plain uuids with no
-- FK, so a made-up student id is enough).
--
-- Run from the repo root:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-unlock-gate.sql
--
-- The migration is applied INSIDE the transaction below (\i), so even the
-- function replacement is undone by the ROLLBACK. Running this proves the new
-- rules against a real database without changing it.
--
-- Every check is an ASSERT: the script is silent on success and aborts with
-- the failing rule's name otherwise.

BEGIN;

\i supabase/migrations/20260922100000_gate_never_relocks_finished_work.sql

DO $verify$
DECLARE
  c_prev   uuid;  -- the prerequisite course
  c_next   uuid;  -- the course gated behind it
  m_prev   uuid;
  m_next   uuid;
  l_prev_1 uuid;  -- visible lesson in the prerequisite
  l_prev_h uuid;  -- HIDDEN lesson in the prerequisite
  l_next_1 uuid;
  l_next_2 uuid;
  l_prev_new uuid;
  student  uuid := gen_random_uuid();
  fresh    uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  staff    uuid := gen_random_uuid();
BEGIN
  -- ── Fixtures: a two-course chain, one hidden lesson in the prerequisite ──
  INSERT INTO public.courses (title, is_published, is_optional, order_index, lessons_in_order)
       VALUES ('VERIFY prev', true, false, 0, true) RETURNING id INTO c_prev;
  INSERT INTO public.courses (title, is_published, is_optional, order_index, lessons_in_order, prerequisite_course_id)
       VALUES ('VERIFY next', true, false, 1, true, c_prev) RETURNING id INTO c_next;

  INSERT INTO public.modules (course_id, title, order_index)
       VALUES (c_prev, 'M', 0) RETURNING id INTO m_prev;
  INSERT INTO public.modules (course_id, title, order_index)
       VALUES (c_next, 'M', 0) RETURNING id INTO m_next;

  INSERT INTO public.lessons (module_id, title, order_index, is_hidden)
       VALUES (m_prev, 'prev visible', 0, false) RETURNING id INTO l_prev_1;
  INSERT INTO public.lessons (module_id, title, order_index, is_hidden)
       VALUES (m_prev, 'prev HIDDEN',  1, true)  RETURNING id INTO l_prev_h;
  INSERT INTO public.lessons (module_id, title, order_index, is_hidden)
       VALUES (m_next, 'next one', 0, false) RETURNING id INTO l_next_1;
  INSERT INTO public.lessons (module_id, title, order_index, is_hidden)
       VALUES (m_next, 'next two', 1, false) RETURNING id INTO l_next_2;

  INSERT INTO public.enrollments (course_id, user_id) VALUES (c_prev, student), (c_next, student);
  INSERT INTO public.enrollments (course_id, user_id) VALUES (c_prev, fresh),   (c_next, fresh);
  INSERT INTO public.enrollments (course_id, user_id) VALUES (c_next, outsider);  -- not enrolled in the prereq

  -- ── 1. The gate still gates. A student who has done nothing stays out. ──
  ASSERT public.is_course_unlocked(c_next, fresh) = false,
    '1. an untouched course behind an unfinished prerequisite must stay locked';

  -- ── 2. Not enrolled in the prerequisite → never gated by it. ──
  ASSERT public.is_course_unlocked(c_next, outsider) = true,
    '2. a student who does not own the prerequisite must not be gated by it';

  -- ── 3. A hidden lesson in the prerequisite must not block. ──
  -- The student finishes everything she can SEE in the prerequisite. The
  -- hidden lesson stays incomplete because she cannot reach it.
  INSERT INTO public.lesson_completions (lesson_id, user_id) VALUES (l_prev_1, student);
  ASSERT public.is_course_unlocked(c_next, student) = true,
    '3. a hidden lesson in the prerequisite must not be an unsatisfiable lock';
  ASSERT public.is_lesson_unlocked(l_next_1, student) = true,
    '3b. the first lesson of the gated course must open once the visible prerequisite is done';

  -- ── 4. The within-course sequence still paces a first pass. ──
  ASSERT public.is_lesson_unlocked(l_next_2, student) = false,
    '4. lesson two must stay locked until lesson one is complete';
  INSERT INTO public.lesson_completions (lesson_id, user_id) VALUES (l_next_1, student), (l_next_2, student);

  -- ── 5. Finished work is never taken back. ──
  -- A new lesson lands in the prerequisite AFTER she completed this course.
  -- Before this migration that re-locked every lesson she had already watched.
  INSERT INTO public.lessons (module_id, title, order_index, is_hidden)
       VALUES (m_prev, 'prev added later', 2, false) RETURNING id INTO l_prev_new;
  ASSERT public.is_course_unlocked(c_next, student) = true,
    '5. a course the student already completed must not re-lock when the prerequisite grows';
  ASSERT public.is_lesson_unlocked(l_next_1, student) = true,
    '5b. an already-watched lesson must stay open for review';
  ASSERT public.is_lesson_unlocked(l_next_2, student) = true,
    '5c. every already-watched lesson must stay open for review';

  -- ...and the same growth DOES still gate a student who never started.
  ASSERT public.is_course_unlocked(c_next, fresh) = false,
    '5d. the new lesson must still gate a student who has not started';

  -- ── 6. Un-marking an early lesson must not strand later completed ones. ──
  DELETE FROM public.lesson_completions WHERE lesson_id = l_next_1 AND user_id = student;
  ASSERT public.is_lesson_unlocked(l_next_2, student) = true,
    '6. a completed lesson must stay open even if an earlier one is un-marked';
  ASSERT public.is_lesson_unlocked(l_next_1, student) = true,
    '6b. the un-marked lesson itself is the frontier and must be open';

  -- ── 7. Staff bypass survives. ──
  INSERT INTO public.user_roles (user_id, role) VALUES (staff, 'admin');
  ASSERT public.is_course_unlocked(c_next, staff) = true
     AND public.is_lesson_unlocked(l_next_2, staff) = true,
    '7. admins and instructors must bypass every gate';

  RAISE NOTICE 'all unlock-gate rules hold';
END
$verify$;

ROLLBACK;
