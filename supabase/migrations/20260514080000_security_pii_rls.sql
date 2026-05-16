-- PII RLS hardening — SEC-041, SEC-042.
--
-- Existing policies on room_messages / room_participants used
-- USING (auth.uid() IS NOT NULL) which lets ANY authenticated user read EVERY
-- message in EVERY room. That's a cross-room (and effectively cross-tenant)
-- PII leak via user_name + message content.
--
-- New rule: only members of a room can read its messages and its participant
-- list. The `rooms` table itself remains discoverable so users can join.
--
-- Idempotent. Apply via Supabase Management API.
--
-- Rollback (paste into Studio to revert):
--   DROP POLICY IF EXISTS "room_messages_members_read" ON public.room_messages;
--   DROP POLICY IF EXISTS "room_participants_members_read" ON public.room_participants;
--   -- Restore the previous open-to-all-authenticated policies:
--   CREATE POLICY "Authenticated users can view room messages"
--     ON public.room_messages FOR SELECT USING (auth.uid() IS NOT NULL);
--   CREATE POLICY "Authenticated users can view participants"
--     ON public.room_participants FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── SEC-041: room_messages — members-only SELECT ────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can view room messages" ON public.room_messages;
DROP POLICY IF EXISTS "room_messages_members_read" ON public.room_messages;

CREATE POLICY "room_messages_members_read"
  ON public.room_messages FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.room_participants p
      WHERE p.room_id = room_messages.room_id
        AND p.user_id = (auth.uid())::text
    )
  );

-- ── SEC-042: room_participants — members-only SELECT ────────────────────────
-- A user can see the participant list of a room IF they themselves are a
-- participant. They can always see their OWN row (so we don't break the
-- "am I in this room?" lookup that the frontend uses to gate joins).
DROP POLICY IF EXISTS "Authenticated users can view participants" ON public.room_participants;
DROP POLICY IF EXISTS "room_participants_members_read" ON public.room_participants;
DROP POLICY IF EXISTS "room_participants_self_read" ON public.room_participants;

CREATE POLICY "room_participants_self_read"
  ON public.room_participants FOR SELECT
  USING (user_id = (auth.uid())::text);

CREATE POLICY "room_participants_members_read"
  ON public.room_participants FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.room_participants self
      WHERE self.room_id = room_participants.room_id
        AND self.user_id = (auth.uid())::text
    )
  );

-- Helpful indexes (free guard against the recursive EXISTS being slow).
CREATE INDEX IF NOT EXISTS room_participants_room_user_idx
  ON public.room_participants (room_id, user_id);
CREATE INDEX IF NOT EXISTS room_messages_room_idx
  ON public.room_messages (room_id);
