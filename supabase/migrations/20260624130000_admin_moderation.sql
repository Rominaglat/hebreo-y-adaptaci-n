-- =============================================================================
-- Let admins/super-admins moderate any room (kick participants), not just the
-- room host. Mirrors the app, which now grants admins full host powers.
-- rooms UPDATE/DELETE already allow admins; this extends the participant
-- DELETE (kick) policy. Self-leave is a separate policy and is unaffected.
-- =============================================================================

DROP POLICY IF EXISTS room_participants_host_kick ON public.room_participants;
CREATE POLICY room_participants_host_kick ON public.room_participants
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id
        AND r.host_id = auth.uid()
    )
    OR public.is_admin_or_instructor(auth.uid())
    OR public.is_super_admin(auth.uid())
  );
