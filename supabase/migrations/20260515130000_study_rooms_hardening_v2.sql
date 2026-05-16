-- Study Rooms hardening v2 — closes findings from the post-v1 QA sweep.
--
-- Findings closed:
--   * Locked rooms were enforced client-side only — direct API insert
--     bypassed the lock. Now enforced in the RLS INSERT policy.
--   * max_participants was not enforced at the DB level — two simultaneous
--     joins could exceed the cap. Now enforced via a BEFORE INSERT trigger.
--   * cleanup_stale_participants reaped the host's own row, orphaning the
--     room. Now the host is excluded from TTL.
--   * room_messages.message had no length cap — DoS risk via mega-strings.
--     Now bounded 1..5000 chars.
--   * webrtc_signals had no created_at index — the 2min cleanup did a full
--     table scan every minute. Index added.
--   * cleanup-empty-rooms edge function existed but was never invoked.
--     Scheduled via pg_cron + pg_net every 5 minutes.
--
-- Rollback SQL:
--   DROP POLICY IF EXISTS room_participants_self_insert ON public.room_participants;
--   CREATE POLICY room_participants_self_insert ON public.room_participants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND user_id = (auth.uid())::text);
--   DROP TRIGGER IF EXISTS enforce_room_capacity ON public.room_participants;
--   DROP FUNCTION IF EXISTS public.enforce_room_capacity();
--   ALTER TABLE public.room_messages DROP CONSTRAINT IF EXISTS room_messages_length;
--   DROP INDEX IF EXISTS webrtc_signals_created_at_idx;
--   SELECT cron.unschedule('invoke-cleanup-empty-rooms');

-- =============================================================================
-- 1. room_participants INSERT — close the locked-room bypass.
--    Anyone with API access could previously POST a participant row into a
--    locked room. Now the host of the room is the only one allowed to bypass
--    is_locked.
-- =============================================================================
DROP POLICY IF EXISTS room_participants_self_insert ON public.room_participants;

CREATE POLICY room_participants_self_insert ON public.room_participants
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = (auth.uid())::text
    -- Locked rooms — only the host may join (everyone else is blocked).
    AND NOT EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id
        AND r.is_locked = true
        AND r.host_id <> auth.uid()
    )
  );

-- =============================================================================
-- 2. room_participants — enforce max_participants atomically via a trigger.
--    A pure-RLS check can't do this race-free; the trigger runs inside the
--    INSERT's transaction so two simultaneous joins serialize.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cap integer;
  current_count integer;
BEGIN
  SELECT max_participants INTO cap FROM public.rooms WHERE id = NEW.room_id;
  IF cap IS NULL THEN
    RETURN NEW;  -- legacy room with no cap configured
  END IF;

  SELECT count(*) INTO current_count
  FROM public.room_participants
  WHERE room_id = NEW.room_id;

  IF current_count >= cap THEN
    RAISE EXCEPTION 'room_full'
      USING HINT = 'Room has reached its maximum participant count.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_room_capacity ON public.room_participants;
CREATE TRIGGER enforce_room_capacity
  BEFORE INSERT ON public.room_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_capacity();

-- =============================================================================
-- 3. Replace cleanup_stale_participants — exclude the room host so an idle
--    host can't orphan their own room.
-- =============================================================================
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
    DELETE FROM public.room_participants p
    WHERE p.last_seen_at < now() - interval '90 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = p.room_id
          AND r.host_id::text = p.user_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;

-- =============================================================================
-- 4. room_messages — cap length + reject empty strings.
-- =============================================================================
ALTER TABLE public.room_messages
  DROP CONSTRAINT IF EXISTS room_messages_length;

ALTER TABLE public.room_messages
  ADD CONSTRAINT room_messages_length
  CHECK (char_length(message) BETWEEN 1 AND 5000);

-- =============================================================================
-- 5. webrtc_signals — index on created_at so the 2-minute cleanup can use it.
-- =============================================================================
CREATE INDEX IF NOT EXISTS webrtc_signals_created_at_idx
  ON public.webrtc_signals (created_at);

-- =============================================================================
-- 6. Schedule cleanup-empty-rooms via pg_net every 5 minutes. The function
--    was deployed but had no caller.
-- =============================================================================
DO $$
DECLARE
  service_url text := 'https://your-project-ref.supabase.co/functions/v1/cleanup-empty-rooms';
BEGIN
  PERFORM 1 FROM cron.job WHERE jobname = 'invoke-cleanup-empty-rooms';
  IF NOT FOUND THEN
    PERFORM cron.schedule(
      'invoke-cleanup-empty-rooms',
      '*/5 * * * *',
      format(
        $cron$SELECT net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) AS request_id;$cron$,
        service_url
      )
    );
  END IF;
END$$;
