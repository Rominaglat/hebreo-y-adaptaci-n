-- =============================================================================
-- Invite links to private rooms.
--
-- "Locked / private" now means "unlisted — join via the invite link", not
-- "host only". The invite link (/study-rooms?room=<uuid>) is the invitation,
-- and the room id is an unguessable UUID, so anyone who has the link may join
-- (Google-Meet "anyone with the link" model). The previous self-insert policy
-- blocked non-hosts from joining locked rooms, which made invite links useless.
--
-- We keep the rest of the protection: you may only insert YOUR OWN participant
-- row (user_id = auth.uid()), never someone else's.
--
-- (For a stricter "host must admit each guest" model, replace this with a
-- knock/approval flow — not implemented here.)
-- =============================================================================

DROP POLICY IF EXISTS room_participants_self_insert ON public.room_participants;
CREATE POLICY room_participants_self_insert ON public.room_participants
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );
