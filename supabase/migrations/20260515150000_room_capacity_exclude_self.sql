-- Fix: enforce_room_capacity counted the user being upserted toward the cap,
-- so a user re-joining a full room they were already in got rejected with
-- "room_full" instead of hitting the ON CONFLICT DO UPDATE path. Exclude
-- NEW.user_id from the count.
--
-- Rollback SQL:
--   -- restore the previous version (which counted everyone including self):
--   CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
--   RETURNS trigger LANGUAGE plpgsql AS $$
--   DECLARE cap integer; current_count integer;
--   BEGIN
--     SELECT max_participants INTO cap FROM public.rooms WHERE id = NEW.room_id;
--     IF cap IS NULL THEN RETURN NEW; END IF;
--     SELECT count(*) INTO current_count FROM public.room_participants WHERE room_id = NEW.room_id;
--     IF current_count >= cap THEN RAISE EXCEPTION 'room_full'; END IF;
--     RETURN NEW;
--   END; $$;

CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  cap integer;
  current_count integer;
BEGIN
  SELECT max_participants INTO cap FROM public.rooms WHERE id = NEW.room_id;
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count only OTHER participants. Without this, a user re-joining a room
  -- they're already in would have their own existing row counted toward
  -- the cap, so an upsert at a full room (which should hit ON CONFLICT
  -- DO UPDATE) gets rejected by the trigger BEFORE INSERT can convert
  -- into the UPDATE path.
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
