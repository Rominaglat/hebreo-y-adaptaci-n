-- Fix: room_participants_members_read self-referenced room_participants
-- inside its USING clause, which caused 42P17 "infinite recursion detected
-- in policy" any time a query or trigger did a SELECT on
-- room_participants while RLS was active. The capacity trigger introduced
-- in 20260515130000 tripped this on every join attempt.
--
-- The recursion was pre-existing — the trigger merely exposed it because
-- pure user SELECTs apparently took a different planner path that didn't
-- materialize the self-reference, while a plpgsql function SELECTing the
-- same table with RLS active does.
--
-- Replace the policy with a non-recursive equivalent: you can see
-- participants of any room you can see. The rooms SELECT policy already
-- filters by tenant membership, so this is no broader than what the
-- lobby already exposes.
--
-- Belt-and-suspenders: mark the trigger SECURITY DEFINER so even a future
-- policy that slips back into self-reference can't break inserts.
--
-- Rollback SQL:
--   DROP POLICY IF EXISTS room_participants_members_read ON public.room_participants;
--   CREATE POLICY room_participants_members_read ON public.room_participants
--     FOR SELECT USING (
--       (auth.uid() IS NOT NULL) AND EXISTS (
--         SELECT 1 FROM public.room_participants self
--         WHERE self.room_id = room_participants.room_id
--           AND self.user_id = (auth.uid())::text
--       )
--     );
--   -- (the prior trigger function did not have SECURITY DEFINER)

DROP POLICY IF EXISTS room_participants_members_read ON public.room_participants;

CREATE POLICY room_participants_members_read ON public.room_participants
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  cap integer;
  current_count integer;
BEGIN
  SELECT max_participants INTO cap FROM public.rooms WHERE id = NEW.room_id;
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;

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
