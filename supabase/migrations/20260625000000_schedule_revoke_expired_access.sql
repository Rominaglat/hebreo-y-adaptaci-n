-- =============================================================================
-- Ensure the access-limit auto-revoke sweep is actually scheduled.
--
-- The original feature migration (20260623120000_access_time_limit) created the
-- access_limits table + revoke_expired_access() sweep, but GUARDED the pg_cron
-- scheduling on the extension already being enabled:
--
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') ...
--
-- On the production project pg_cron was NOT enabled, so the block silently
-- skipped (RAISE NOTICE only) and the sweep was never scheduled — expired
-- limits never auto-revoked. This migration enables pg_cron and schedules the
-- job unconditionally (idempotent), so every environment is set up correctly.
-- =============================================================================

-- pg_cron lives in (and the scheduler runs in) the postgres database; on
-- Supabase this runs as the migration's postgres role, which can create it.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  -- Idempotent: only schedule if it isn't already registered.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-revoke-expired-access') THEN
    PERFORM cron.schedule(
      'invoke-revoke-expired-access',
      '*/10 * * * *',
      $cron$SELECT public.revoke_expired_access();$cron$
    );
    RAISE NOTICE 'Scheduled invoke-revoke-expired-access (*/10 * * * *).';
  ELSE
    RAISE NOTICE 'invoke-revoke-expired-access already scheduled — leaving as is.';
  END IF;
END$$;
