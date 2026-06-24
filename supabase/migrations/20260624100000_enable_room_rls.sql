-- =============================================================================
-- Enable Row Level Security on the study-room tables + fill the missing
-- policies so enabling RLS does not break the app.
--
-- BACKGROUND: RLS was DISABLED on rooms / room_participants / webrtc_signals /
-- room_messages even though policies were defined — so the policies were never
-- enforced and ANY user (including anon, which holds full table grants) could
-- read/write/delete every room's data (a BOLA hole). This migration adds the
-- INSERT/UPDATE/DELETE policies that were missing and then enables RLS.
--
-- Existing policies kept as-is:
--   rooms:             "Authenticated users can view rooms" (SELECT)
--   room_participants: self_insert (incl. locked-room guard), host_kick (DELETE),
--                      members_read + self_read (SELECT)
--   webrtc_signals:    recipient_read (SELECT), sender_insert (INSERT),
--                      recipient_delete (DELETE)  -- already complete
--   room_messages:     members_read (SELECT)
-- =============================================================================

-- ---- rooms: creator/host/admin write access ---------------------------------
DROP POLICY IF EXISTS rooms_insert_self_host ON public.rooms;
CREATE POLICY rooms_insert_self_host ON public.rooms
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND host_id = auth.uid());

DROP POLICY IF EXISTS rooms_update_host_admin ON public.rooms;
CREATE POLICY rooms_update_host_admin ON public.rooms
  FOR UPDATE
  USING (
    host_id = auth.uid()
    OR public.is_admin_or_instructor(auth.uid())
    OR public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    host_id = auth.uid()
    OR public.is_admin_or_instructor(auth.uid())
    OR public.is_super_admin(auth.uid())
  );

DROP POLICY IF EXISTS rooms_delete_host_admin ON public.rooms;
CREATE POLICY rooms_delete_host_admin ON public.rooms
  FOR DELETE
  USING (
    host_id = auth.uid()
    OR public.is_admin_or_instructor(auth.uid())
    OR public.is_super_admin(auth.uid())
  );

-- ---- room_participants: self can update (mute/cam/heartbeat/name) + leave ----
DROP POLICY IF EXISTS room_participants_self_update ON public.room_participants;
CREATE POLICY room_participants_self_update ON public.room_participants
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Self-leave. (The host_kick DELETE policy already covers host-driven removal;
-- permissive policies are OR'd, so a row is deletable if self OR room host.)
DROP POLICY IF EXISTS room_participants_self_delete ON public.room_participants;
CREATE POLICY room_participants_self_delete ON public.room_participants
  FOR DELETE
  USING (user_id = auth.uid());

-- ---- room_messages: a room member may send as themselves --------------------
-- Enforces sender identity (user_id = auth.uid()) so the displayed sender can't
-- be spoofed, and requires the sender to be a participant of the room.
DROP POLICY IF EXISTS room_messages_member_insert ON public.room_messages;
CREATE POLICY room_messages_member_insert ON public.room_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.room_participants p
      WHERE p.room_id = room_messages.room_id
        AND p.user_id = auth.uid()
    )
  );

-- ---- finally, turn RLS ON ----------------------------------------------------
ALTER TABLE public.rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webrtc_signals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_messages     ENABLE ROW LEVEL SECURITY;
