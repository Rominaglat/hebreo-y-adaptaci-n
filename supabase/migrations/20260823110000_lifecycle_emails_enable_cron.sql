-- =============================================================================
-- TURNS SENDING ON. Apply only when the copy is approved and the dry run looks
-- right — from this point the portal mails real students every 30 minutes.
--
-- To stop it again:  SELECT cron.unschedule('invoke-lifecycle-emails');
-- =============================================================================
-- ── Schedule ────────────────────────────────────────────────────────────────
-- Every 30 min: fine-grained enough that "6h after signup" lands within half an
-- hour, cheap enough to be irrelevant. The sweep is idempotent, so an extra
-- invocation never double-sends.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  service_url text := 'https://gmepopxxvgcwiqlkpuwd.supabase.co/functions/v1/send-lifecycle-emails';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-lifecycle-emails') THEN
    PERFORM cron.schedule(
      'invoke-lifecycle-emails',
      '*/30 * * * *',
      format(
        $cron$SELECT net.http_post(url := %L, headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) AS request_id;$cron$,
        service_url
      )
    );
    RAISE NOTICE 'Scheduled invoke-lifecycle-emails (*/30 * * * *).';
  ELSE
    RAISE NOTICE 'invoke-lifecycle-emails already scheduled — leaving as is.';
  END IF;
END$$;
