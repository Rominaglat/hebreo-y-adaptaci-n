-- scripts/verify-ai-answer-feedback.sql — behavioural proof for
-- 20261021100000_ai_answer_feedback: who may rate which answer, and who may
-- read the admin summary. Applies the migration inside a transaction, uses
-- real conversations, and ROLLS BACK — nothing is kept.
--
-- Run from the repo root:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-ai-answer-feedback.sql

BEGIN;

\i supabase/migrations/20261021100000_ai_answer_feedback.sql

DO $verify$
DECLARE
  student_a uuid; a_answer uuid; a_question uuid;
  student_b uuid; b_answer uuid;
  admin_id  uuid;
  n integer; blocked boolean; summary jsonb;
BEGIN
  -- Two students with at least one assistant answer each, and an admin.
  SELECT c.user_id, m.id INTO student_a, a_answer
  FROM public.chat_messages m JOIN public.chat_conversations c ON c.id = m.conversation_id
  WHERE m.role = 'assistant' AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.user_id AND r.role = 'student')
  ORDER BY m.created_at DESC LIMIT 1;
  SELECT m.id INTO a_question
  FROM public.chat_messages m JOIN public.chat_conversations c ON c.id = m.conversation_id
  WHERE m.role = 'user' AND c.user_id = student_a LIMIT 1;
  SELECT c.user_id, m.id INTO student_b, b_answer
  FROM public.chat_messages m JOIN public.chat_conversations c ON c.id = m.conversation_id
  WHERE m.role = 'assistant' AND c.user_id <> student_a
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = c.user_id AND r.role = 'student')
  ORDER BY m.created_at DESC LIMIT 1;
  SELECT user_id INTO admin_id FROM public.user_roles WHERE role = 'admin' LIMIT 1;
  ASSERT student_a IS NOT NULL AND a_answer IS NOT NULL AND a_question IS NOT NULL
     AND student_b IS NOT NULL AND b_answer IS NOT NULL AND admin_id IS NOT NULL,
    'fixtures: need two students with answers and an admin';

  -- ── As student A ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', student_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO public.chat_message_feedback (message_id, user_id, rating) VALUES (a_answer, student_a, 1);

  UPDATE public.chat_message_feedback SET rating = -1, updated_at = now() WHERE message_id = a_answer;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'a student can change their rating';

  blocked := false;
  BEGIN
    INSERT INTO public.chat_message_feedback (message_id, user_id, rating) VALUES (b_answer, student_a, -1);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot rate someone else''s answer';

  blocked := false;
  BEGIN
    INSERT INTO public.chat_message_feedback (message_id, user_id, rating) VALUES (a_question, student_a, 1);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot rate their own question, only answers';

  blocked := false;
  BEGIN
    INSERT INTO public.chat_message_feedback (message_id, user_id, rating) VALUES (a_answer, student_b, 1);
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN blocked := true;
  END;
  ASSERT blocked, 'a student cannot rate in someone else''s name';

  blocked := false;
  BEGIN
    PERFORM public.admin_ai_feedback(30);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  ASSERT blocked, 'students cannot read the admin summary';

  EXECUTE 'RESET ROLE';

  -- ── As student B: does not see A's rating ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', student_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.chat_message_feedback;
  ASSERT n = 0, 'a student sees only their own ratings';
  EXECUTE 'RESET ROLE';

  -- ── As an admin: the summary includes A's 👎 with its question ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  summary := public.admin_ai_feedback(30);
  ASSERT (summary->>'down')::int >= 1, 'the admin summary counts the 👎';
  ASSERT jsonb_array_length(summary->'recent_down') >= 1, 'the admin summary lists the 👎 answer';
  ASSERT (summary->'recent_down'->0->>'question') IS NOT NULL, 'each 👎 comes with the question that led to it';
  EXECUTE 'RESET ROLE';

  RAISE NOTICE 'verify-ai-answer-feedback: all checks passed';
END
$verify$;

ROLLBACK;
