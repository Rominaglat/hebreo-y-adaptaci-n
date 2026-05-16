-- Study Rooms hardening — Phase 1 (backend safety).
-- Closes the open webrtc_signals RLS (eavesdrop/impersonate), adds host-kick
-- DELETE policy, tightens participant INSERT, adds heartbeat + TTL cleanup
-- via pg_cron, and adds the indexes the signaling/cleanup queries need.
--
-- Rollback SQL:
--   ALTER TABLE public.room_participants DROP COLUMN IF EXISTS last_seen_at;
--   DROP POLICY IF EXISTS webrtc_signals_recipient_read ON public.webrtc_signals;
--   DROP POLICY IF EXISTS webrtc_signals_sender_insert ON public.webrtc_signals;
--   DROP POLICY IF EXISTS webrtc_signals_recipient_delete ON public.webrtc_signals;
--   DROP POLICY IF EXISTS room_participants_self_insert ON public.room_participants;
--   DROP POLICY IF EXISTS room_participants_host_kick ON public.room_participants;
--   CREATE POLICY "Authenticated users can view signals" ON public.webrtc_signals FOR SELECT USING (auth.uid() IS NOT NULL);
--   CREATE POLICY "Authenticated users can send signals" ON public.webrtc_signals FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--   CREATE POLICY "Authenticated users can delete signals" ON public.webrtc_signals FOR DELETE USING (auth.uid() IS NOT NULL);
--   CREATE POLICY "Authenticated users can join rooms" ON public.room_participants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
--   DROP FUNCTION IF EXISTS public.cleanup_stale_participants();
--   DROP FUNCTION IF EXISTS public.cleanup_old_webrtc_signals();
--   SELECT cron.unschedule('cleanup-stale-participants');
--   SELECT cron.unschedule('cleanup-old-webrtc-signals');

-- =============================================================================
-- 1. Heartbeat column for participant TTL cleanup.
-- =============================================================================
ALTER TABLE public.room_participants
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS room_participants_last_seen_idx
  ON public.room_participants (last_seen_at);

-- =============================================================================
-- 2. Indexes the realtime + cleanup queries need.
-- =============================================================================
CREATE INDEX IF NOT EXISTS webrtc_signals_to_user_room_created_idx
  ON public.webrtc_signals (to_user, room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS webrtc_signals_room_created_idx
  ON public.webrtc_signals (room_id, created_at);

CREATE INDEX IF NOT EXISTS room_participants_room_user_idx
  ON public.room_participants (room_id, user_id);

CREATE INDEX IF NOT EXISTS room_messages_room_created_idx
  ON public.room_messages (room_id, created_at DESC);

-- =============================================================================
-- 3. webrtc_signals — drop the wide-open policies and replace with strict ones.
--    The old policies let any authenticated user read/write/delete any signal
--    in any room — i.e. eavesdrop or impersonate.
-- =============================================================================
DROP POLICY IF EXISTS "Authenticated users can view signals"   ON public.webrtc_signals;
DROP POLICY IF EXISTS "Authenticated users can send signals"   ON public.webrtc_signals;
DROP POLICY IF EXISTS "Authenticated users can delete signals" ON public.webrtc_signals;
DROP POLICY IF EXISTS webrtc_signals_recipient_read     ON public.webrtc_signals;
DROP POLICY IF EXISTS webrtc_signals_sender_insert      ON public.webrtc_signals;
DROP POLICY IF EXISTS webrtc_signals_recipient_delete   ON public.webrtc_signals;

-- Recipient is the ONLY reader.
CREATE POLICY webrtc_signals_recipient_read ON public.webrtc_signals
  FOR SELECT
  USING (to_user = (auth.uid())::text);

-- Sender must be the authenticated user AND both endpoints must be
-- participants of the same room. Prevents impersonation and prevents random
-- users from spamming signals into rooms they're not in.
CREATE POLICY webrtc_signals_sender_insert ON public.webrtc_signals
  FOR INSERT
  WITH CHECK (
    from_user = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.room_participants p
      WHERE p.room_id = webrtc_signals.room_id
        AND p.user_id = (auth.uid())::text
    )
    AND EXISTS (
      SELECT 1 FROM public.room_participants p
      WHERE p.room_id = webrtc_signals.room_id
        AND p.user_id = webrtc_signals.to_user
    )
  );

-- Recipient garbage-collects their own inbox; senders may also clean up their
-- own outbox (useful for the joinRoom pre-clean step in the client).
CREATE POLICY webrtc_signals_recipient_delete ON public.webrtc_signals
  FOR DELETE
  USING (
    to_user = (auth.uid())::text
    OR from_user = (auth.uid())::text
  );

-- =============================================================================
-- 4. room_participants — tighten INSERT (no spoofing) and add host-kick DELETE.
-- =============================================================================
DROP POLICY IF EXISTS "Authenticated users can join rooms" ON public.room_participants;
DROP POLICY IF EXISTS room_participants_self_insert       ON public.room_participants;
DROP POLICY IF EXISTS room_participants_host_kick         ON public.room_participants;

-- Joiner must use their own user_id. (Tenant scoping is enforced upstream by
-- the rooms SELECT policy; you can't join a room you can't see.)
CREATE POLICY room_participants_self_insert ON public.room_participants
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = (auth.uid())::text
  );

-- Host of the room may remove any participant (kick).
CREATE POLICY room_participants_host_kick ON public.room_participants
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id
        AND r.host_id = auth.uid()
    )
  );

-- =============================================================================
-- 5. TTL cleanup — kill stale participants + old signals. Two scheduled jobs.
-- =============================================================================

-- Cleans rows where the heartbeat is older than 90s. Returns count for logging.
CREATE OR REPLACE FUNCTION public.cleanup_stale_participants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.room_participants
    WHERE last_seen_at < now() - interval '90 seconds'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;

-- Signals older than 2 minutes are guaranteed-irrelevant (offer/answer round
-- trips complete in < 10s in practice; ICE candidates trickle for up to ~30s).
CREATE OR REPLACE FUNCTION public.cleanup_old_webrtc_signals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.webrtc_signals
    WHERE created_at < now() - interval '2 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;

-- Schedule (idempotent via guard).
DO $$
BEGIN
  PERFORM 1 FROM cron.job WHERE jobname = 'cleanup-stale-participants';
  IF NOT FOUND THEN
    PERFORM cron.schedule(
      'cleanup-stale-participants',
      '*/1 * * * *',  -- every minute (cron min granularity)
      $cron$SELECT public.cleanup_stale_participants();$cron$
    );
  END IF;

  PERFORM 1 FROM cron.job WHERE jobname = 'cleanup-old-webrtc-signals';
  IF NOT FOUND THEN
    PERFORM cron.schedule(
      'cleanup-old-webrtc-signals',
      '*/1 * * * *',
      $cron$SELECT public.cleanup_old_webrtc_signals();$cron$
    );
  END IF;
END$$;
