-- 👍 / 👎 on Romina AI answers, so whether the October 2026 improvements worked
-- can be measured from real use instead of waiting for the monthly survey.
--
-- Data class: per-user. A student rates only assistant answers in THEIR OWN
-- conversations (the same ownership rule chat_messages uses), one rating per
-- answer, changeable. Admins read aggregates through admin_ai_feedback(),
-- which returns the question / answer text ONLY for answers rated 👎 — the
-- student flagged those for attention themselves.

CREATE TABLE IF NOT EXISTS public.chat_message_feedback (
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_message_feedback_created_idx ON public.chat_message_feedback (created_at DESC);

ALTER TABLE public.chat_message_feedback ENABLE ROW LEVEL SECURITY;

-- An assistant answer in a conversation the caller owns.
CREATE OR REPLACE FUNCTION public.is_own_assistant_message(_message_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_messages m
    JOIN public.chat_conversations c ON c.id = m.conversation_id
    WHERE m.id = _message_id AND m.role = 'assistant' AND c.user_id = auth.uid()
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_own_assistant_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_own_assistant_message(uuid) TO authenticated;

DROP POLICY IF EXISTS chat_feedback_read ON public.chat_message_feedback;
CREATE POLICY chat_feedback_read ON public.chat_message_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS chat_feedback_insert ON public.chat_message_feedback;
CREATE POLICY chat_feedback_insert ON public.chat_message_feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_own_assistant_message(message_id));

-- Changing your mind (👍 → 👎). The row stays yours and on your own answer.
DROP POLICY IF EXISTS chat_feedback_update ON public.chat_message_feedback;
CREATE POLICY chat_feedback_update ON public.chat_message_feedback
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_own_assistant_message(message_id));

DROP POLICY IF EXISTS chat_feedback_delete ON public.chat_message_feedback;
CREATE POLICY chat_feedback_delete ON public.chat_message_feedback
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.chat_message_feedback FROM anon;
REVOKE TRUNCATE ON public.chat_message_feedback FROM authenticated;

-- ── Admin summary ────────────────────────────────────────────────────────────
-- Counts for the last _days, plus the 👎 answers with the question that led to
-- them. SECURITY DEFINER to read across students' chats — so it checks the
-- caller is an admin itself and raises otherwise.
CREATE OR REPLACE FUNCTION public.admin_ai_feedback(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(_days, 30), 365)));
  result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'days', extract(day FROM now() - since)::int,
    'answers', (SELECT count(*) FROM public.chat_messages m WHERE m.role = 'assistant' AND m.created_at >= since),
    'up', (SELECT count(*) FROM public.chat_message_feedback f WHERE f.rating = 1 AND f.updated_at >= since),
    'down', (SELECT count(*) FROM public.chat_message_feedback f WHERE f.rating = -1 AND f.updated_at >= since),
    'recent_down', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'rated_at' DESC)
      FROM (
        SELECT jsonb_build_object(
          'rated_at', f.updated_at,
          'answer', left(a.content, 600),
          'question', left((
            SELECT q.content FROM public.chat_messages q
            WHERE q.conversation_id = a.conversation_id AND q.role = 'user' AND q.created_at <= a.created_at
            ORDER BY q.created_at DESC LIMIT 1), 300)
        ) AS x
        FROM public.chat_message_feedback f
        JOIN public.chat_messages a ON a.id = f.message_id
        WHERE f.rating = -1 AND f.updated_at >= since
        ORDER BY f.updated_at DESC
        LIMIT 20
      ) recent
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_ai_feedback(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_feedback(integer) TO authenticated;
