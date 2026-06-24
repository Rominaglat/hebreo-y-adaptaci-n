-- =============================================================================
-- room_participants: add the UNIQUE (room_id, user_id) constraint that the
-- join upsert depends on.
--
-- joinRoom() does:
--   supabase.from('room_participants').upsert({...}, { onConflict: 'room_id,user_id' })
-- which Postgres rejects with `42P10: there is no unique or exclusion
-- constraint matching the ON CONFLICT specification` unless a UNIQUE (or
-- exclusion) constraint exists on exactly (room_id, user_id). Only a NON-unique
-- index existed, so joining a room failed for every user. This adds the
-- constraint (idempotent) and drops the now-redundant plain index.
--
-- Safe to run on a populated table only if there are no duplicate
-- (room_id, user_id) rows; the de-dup CTE below removes any before adding the
-- constraint (keeps the most recently seen row per pair).
-- =============================================================================

-- De-dup defensively: keep the freshest row per (room_id, user_id).
DELETE FROM public.room_participants a
USING public.room_participants b
WHERE a.room_id = b.room_id
  AND a.user_id = b.user_id
  AND a.last_seen_at < b.last_seen_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.room_participants'::regclass
      AND conname = 'room_participants_room_user_unique'
  ) THEN
    ALTER TABLE public.room_participants
      ADD CONSTRAINT room_participants_room_user_unique UNIQUE (room_id, user_id);
  END IF;
END $$;

-- The unique constraint creates its own index; drop the redundant plain one.
DROP INDEX IF EXISTS public.room_participants_room_user_idx;
