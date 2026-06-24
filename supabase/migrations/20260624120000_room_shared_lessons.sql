-- =============================================================================
-- room_shared_lessons(room_id): the lessons that EVERY current participant of a
-- room may access — used by the in-call "watch a course video together" picker.
--
-- Why: the old client-side fetch (a) only checked the current user's role and
-- enrollments, and (b) didn't recognize the 'super_admin' role, so a super-admin
-- with no enrollments saw "no lessons available". More importantly, sharing must
-- not let a "shared account" leak paid content: a lesson is only offered if
-- EVERY participant already has access to it (admins/instructors/super-admins
-- have access to everything; students must be enrolled in the course).
--
-- SECURITY DEFINER so it can read enrollments/roles for all participants without
-- exposing that raw data to the client. The caller MUST be a participant of the
-- room (so non-members can't enumerate other rooms' shared video URLs).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.room_shared_lessons(p_room_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  video_url text,
  course_id uuid,
  course_title text,
  order_index integer,
  module_title text,
  module_order integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH parts AS (
    SELECT user_id FROM public.room_participants WHERE room_id = p_room_id
  ),
  pcount AS (SELECT count(*)::int AS n FROM parts),
  privileged AS (
    SELECT user_id FROM parts p WHERE public.is_admin_or_instructor(p.user_id)
  ),
  course_access AS (
    SELECT c.id AS course_id,
           (SELECT count(*) FROM privileged)
           + (SELECT count(DISTINCT e.user_id)
                FROM public.enrollments e
                JOIN parts p ON p.user_id = e.user_id
               WHERE e.course_id = c.id
                 AND e.user_id NOT IN (SELECT user_id FROM privileged)) AS access_count
    FROM public.courses c
    WHERE c.is_published
  )
  SELECT l.id, l.title, l.video_url,
         c.id AS course_id, c.title AS course_title,
         COALESCE(l.order_index, 0) AS order_index,
         m.title AS module_title, COALESCE(m.order_index, 0) AS module_order
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  JOIN course_access ca ON ca.course_id = c.id
  CROSS JOIN pcount
  WHERE l.video_url IS NOT NULL
    AND c.is_published
    AND pcount.n > 0
    AND ca.access_count >= pcount.n
    -- Caller must be a participant of the room.
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id = p_room_id AND rp.user_id = auth.uid()
    )
  ORDER BY c.title, m.order_index, l.order_index;
$$;

GRANT EXECUTE ON FUNCTION public.room_shared_lessons(uuid) TO authenticated;
