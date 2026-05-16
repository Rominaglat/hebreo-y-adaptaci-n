-- Phase 2 — Edge function hardening.
--
-- Adds:
--   - SEC-012: `rate_limit_buckets` table + `check_and_increment_rate_limit(...)`
--     atomic Postgres function. Used by _shared/rate-limit.ts on AI/KG endpoints.
--   - SEC-019: `developer_settings.webhook_signing_secret` column for outbound
--     HMAC signing.
--
-- Idempotent. Apply via Supabase Management API.
--
-- Rollback:
--   ALTER TABLE developer_settings DROP COLUMN IF EXISTS webhook_signing_secret;
--   DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(text, int);
--   DROP TABLE IF EXISTS public.rate_limit_buckets;

-- ── 1. Rate-limit buckets (SEC-012) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- Only service-role writes; no end-user access required.
DROP POLICY IF EXISTS "rate_limit_buckets_no_user_access" ON public.rate_limit_buckets;
-- (no CREATE POLICY — absence of policies blocks anon and authenticated)

CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_start_idx
  ON public.rate_limit_buckets (window_start);

-- Atomic increment-with-window-roll. Returns true if the request is allowed,
-- false if the limit would be exceeded.
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_limit_per_minute INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_window_start TIMESTAMPTZ := date_trunc('minute', v_now);
  v_count INT;
BEGIN
  INSERT INTO public.rate_limit_buckets(key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key) DO UPDATE
    SET
      window_start = CASE
        WHEN public.rate_limit_buckets.window_start < EXCLUDED.window_start
          THEN EXCLUDED.window_start
        ELSE public.rate_limit_buckets.window_start
      END,
      count = CASE
        WHEN public.rate_limit_buckets.window_start < EXCLUDED.window_start
          THEN 1
        ELSE public.rate_limit_buckets.count + 1
      END
    RETURNING count INTO v_count;

  RETURN v_count <= p_limit_per_minute;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INT) TO service_role;

-- Garbage collect stale buckets (>= 5 minutes old) once an hour.
-- pg_cron isn't always available; treat this as a hint, not a hard requirement.
-- Cleanup query for ops:
--   DELETE FROM public.rate_limit_buckets WHERE window_start < now() - INTERVAL '5 minutes';

-- ── 2. Webhook signing secret (SEC-019) ─────────────────────────────────────
ALTER TABLE public.developer_settings
  ADD COLUMN IF NOT EXISTS webhook_signing_secret TEXT;

COMMENT ON COLUMN public.developer_settings.webhook_signing_secret IS
  'Per-config HMAC secret used by audit-webhook to sign outbound payloads.
   Receivers verify X-Signature: sha256=<hex> over the request body.';
