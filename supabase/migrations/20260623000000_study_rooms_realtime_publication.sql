-- =============================================================================
-- Study rooms — codify realtime delivery for the room tables.
--
-- The entire study-room feature relies on postgres_changes subscriptions:
--   * webrtc_signals      — WebRTC offer/answer/ICE signaling
--   * room_participants   — presence / roster / mute-cam status
--   * room_messages       — in-call chat (INSERT + DELETE)
--   * rooms               — synced-video state + is_recording banner
--
-- None of these were ever added to the `supabase_realtime` publication in a
-- migration, so realtime worked only if someone toggled it by hand in the
-- dashboard. This migration makes it deterministic (and idempotent).
--
-- REPLICA IDENTITY FULL is required so DELETE/UPDATE events carry the OLD row
-- (e.g. useRoomChat's DELETE handler reads payload.old.id, and the roster needs
-- to detect which participant left).
-- =============================================================================

ALTER TABLE public.room_participants REPLICA IDENTITY FULL;
ALTER TABLE public.webrtc_signals    REPLICA IDENTITY FULL;
ALTER TABLE public.room_messages     REPLICA IDENTITY FULL;
ALTER TABLE public.rooms             REPLICA IDENTITY FULL;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'room_participants',
    'webrtc_signals',
    'room_messages',
    'rooms'
  ];
BEGIN
  -- Only proceed if the Supabase realtime publication exists (it does on every
  -- Supabase project; guarded so a bare-Postgres run doesn't error).
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY tables LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = tbl
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl
        );
        RAISE NOTICE 'Added public.% to supabase_realtime', tbl;
      END IF;
    END LOOP;
  END IF;
END $$;
