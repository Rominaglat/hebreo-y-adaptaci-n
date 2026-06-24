-- =============================================================================
-- Self-healing room capacity: reap stale "ghost" participant rows on every join.
--
-- pg_cron is NOT enabled on this project, so cleanup_stale_participants never
-- runs and ghost rows (left by a refresh/crash where the page-unload DELETE
-- failed) accumulate forever — filling rooms so users get "room_full" and can't
-- rejoin, and leaving dead peers others try to connect to.
--
-- Fix: the BEFORE INSERT capacity trigger now first DELETEs rows in the room
-- whose heartbeat is older than 90s, THEN counts. Live users heartbeat every
-- 30s so they're never reaped; ghosts are. No external scheduler needed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cap integer;
  current_count integer;
BEGIN
  SELECT max_participants INTO cap FROM public.rooms WHERE id = NEW.room_id;
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reap ghosts in this room before counting (self-healing, no pg_cron needed).
  DELETE FROM public.room_participants
  WHERE room_id = NEW.room_id
    AND user_id <> NEW.user_id
    AND last_seen_at < now() - interval '90 seconds';

  SELECT count(*) INTO current_count
  FROM public.room_participants
  WHERE room_id = NEW.room_id
    AND user_id <> NEW.user_id;

  IF current_count >= cap THEN
    RAISE EXCEPTION 'room_full'
      USING HINT = 'Room has reached its maximum participant count.';
  END IF;

  RETURN NEW;
END;
$function$;
