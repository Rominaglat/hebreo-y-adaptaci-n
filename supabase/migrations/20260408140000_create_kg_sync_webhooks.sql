-- Knowledge Graph sync: Database triggers that fire on every INSERT/UPDATE/DELETE
-- in tenants/courses/modules/lessons and POST the row to the kg-sync edge function.
--
-- Why triggers (not Supabase "Database Webhooks" UI):
--   - Explicit, version-controlled, idempotent.
--   - Survives Supabase Studio churn / lost configs.
--   - Single source of truth.
--
-- Requires extension: pg_net (already enabled in Supabase by default).
--
-- Configuration is stored in Supabase Vault (encrypted at rest):
--   kg_sync_url        — full URL of the kg-sync edge function
--   kg_webhook_secret  — shared secret matching KG_WEBHOOK_SECRET
-- The trigger function reads these via vault.decrypted_secrets.

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ─── Vault secrets ───────────────────────────────────────────────────────────
-- Idempotent upsert: if a secret with this name already exists, update it.
DO $$
DECLARE
  existing_id uuid;
BEGIN
  -- kg_sync_url
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'kg_sync_url';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      'https://your-project-ref.supabase.co/functions/v1/kg-sync',
      'kg_sync_url',
      'kg-sync edge function URL'
    );
  ELSE
    PERFORM vault.update_secret(
      existing_id,
      'https://your-project-ref.supabase.co/functions/v1/kg-sync'
    );
  END IF;

  -- kg_webhook_secret
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'kg_webhook_secret';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      'babe86e67077e5705f2c5fa8c88aa44671132cd9898aa50ae046e6d8566779d7',
      'kg_webhook_secret',
      'Shared secret between Postgres triggers and kg-sync edge function'
    );
  ELSE
    PERFORM vault.update_secret(
      existing_id,
      'babe86e67077e5705f2c5fa8c88aa44671132cd9898aa50ae046e6d8566779d7'
    );
  END IF;
END $$;

-- ─── Trigger function ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kg_sync_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  payload jsonb;
  url     text;
  secret  text;
BEGIN
  SELECT decrypted_secret INTO url    FROM vault.decrypted_secrets WHERE name = 'kg_sync_url'       LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'kg_webhook_secret' LIMIT 1;

  IF url IS NULL OR secret IS NULL THEN
    RAISE WARNING 'kg_sync_dispatch: missing vault secrets kg_sync_url / kg_webhook_secret';
    RETURN COALESCE(NEW, OLD);
  END IF;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    'old_record', CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END
  );

  -- Fire-and-forget HTTP POST. pg_net is non-blocking; if kg-sync is down,
  -- the row write still succeeds and the queued request can be retried/inspected
  -- via SELECT * FROM net._http_response WHERE status_code != 200.
  PERFORM net.http_post(
    url     := url,
    body    := payload,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-Webhook-Secret', secret
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- NEVER let KG sync failures block a row write. Log and continue.
  RAISE WARNING 'kg_sync_dispatch failed for % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─── Triggers on the four content tables ─────────────────────────────────────

DROP TRIGGER IF EXISTS kg_sync_tenants ON public.tenants;
CREATE TRIGGER kg_sync_tenants
  AFTER INSERT OR UPDATE OR DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.kg_sync_dispatch();

DROP TRIGGER IF EXISTS kg_sync_courses ON public.courses;
CREATE TRIGGER kg_sync_courses
  AFTER INSERT OR UPDATE OR DELETE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.kg_sync_dispatch();

DROP TRIGGER IF EXISTS kg_sync_modules ON public.modules;
CREATE TRIGGER kg_sync_modules
  AFTER INSERT OR UPDATE OR DELETE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.kg_sync_dispatch();

DROP TRIGGER IF EXISTS kg_sync_lessons ON public.lessons;
CREATE TRIGGER kg_sync_lessons
  AFTER INSERT OR UPDATE OR DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.kg_sync_dispatch();

-- ─── Helper view for ops ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.kg_sync_recent_failures AS
SELECT id, status_code, content_type, content, created
FROM net._http_response
WHERE status_code IS NULL OR status_code >= 400
ORDER BY created DESC
LIMIT 100;

COMMENT ON VIEW public.kg_sync_recent_failures IS
  'Recent failed kg-sync HTTP calls. Use to debug webhook delivery issues.';
