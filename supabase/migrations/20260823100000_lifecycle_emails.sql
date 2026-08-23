-- =============================================================================
-- Lifecycle emails: welcome (6h), tips (48h), win-back (7d inactive).
--
-- Data classification:
--   student_activity      Per-user telemetry. Service-role only — the client
--                         never reads or writes it directly (see touch_last_active).
--   lifecycle_email_prefs Per-user, and unsubscribe_token is a CAPABILITY: whoever
--                         holds it can unsubscribe that user. Nothing the app does
--                         needs it, so the table is service-role only (deny-all).
--   lifecycle_email_sends Send ledger + idempotency. No UI reads it; service-role only.
--
-- All three get RLS ENABLED with no anon/authenticated policies, which is
-- deny-all. service_role (edge functions) bypasses RLS and keeps working.
-- =============================================================================

-- ── Activity signal ─────────────────────────────────────────────────────────
-- Deliberately NOT a column on profiles: profiles has a self-update policy, so
-- a student could forge their own last_active_at to dodge the win-back email.
-- Postgres cannot revoke UPDATE on a single column while a table-level grant
-- exists, so the signal lives in its own table that only the definer RPC writes.
CREATE TABLE IF NOT EXISTS public.student_activity (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_activity_last_active
  ON public.student_activity (last_active_at);

ALTER TABLE public.student_activity ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all for anon + authenticated. Writes go through the RPC below.

-- The ONLY way a client marks itself active. Takes no arguments, so a caller
-- cannot touch another user's row; SECURITY DEFINER lets it write past the
-- deny-all RLS above.
CREATE OR REPLACE FUNCTION public.touch_last_active()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.student_activity (user_id, last_active_at)
  SELECT auth.uid(), now()
  WHERE auth.uid() IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET last_active_at = now();
$$;

REVOKE ALL ON FUNCTION public.touch_last_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_active() TO authenticated;

-- ── Email preferences / unsubscribe ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lifecycle_email_prefs (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  emails_enabled    boolean     NOT NULL DEFAULT true,
  unsubscribe_token uuid        NOT NULL DEFAULT gen_random_uuid(),
  unsubscribed_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_prefs_token
  ON public.lifecycle_email_prefs (unsubscribe_token);

ALTER TABLE public.lifecycle_email_prefs ENABLE ROW LEVEL SECURITY;
-- No policies: the token must never reach the browser. The unsubscribe edge
-- function (service_role) is the only reader/writer.

-- ── Send ledger ─────────────────────────────────────────────────────────────
-- UNIQUE (user_id, kind, dedupe_key) IS the idempotency mechanism. dedupe_key
-- is 'once' for the onboarding pair (one per user, ever) and the UTC date
-- activity stopped for the win-back mail — so a student who returns and lapses
-- again gets a new key, and therefore a new send, with no reset bookkeeping.
CREATE TABLE IF NOT EXISTS public.lifecycle_email_sends (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('welcome_6h','tips_48h','inactive_7d')),
  dedupe_key   text NOT NULL,
  email_status text NOT NULL DEFAULT 'claimed'
                 CHECK (email_status IN ('claimed','sent','failed','skipped_pre_launch')),
  resend_id    text,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_sends_kind_status
  ON public.lifecycle_email_sends (kind, email_status, created_at DESC);

ALTER TABLE public.lifecycle_email_sends ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all. Only the sweep (service_role) touches it.

-- ── Launch guard ────────────────────────────────────────────────────────────
-- Onboarding mail is for people who sign up from here on. Two independent
-- guards, because mailing the whole back catalogue a "welcome" note once is
-- unrecoverable:
--   1. this timestamp, checked by the sweep, and
--   2. the pre-seeded ledger rows below, which make it physically impossible.
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS lifecycle_emails_start_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.lifecycle_email_sends (user_id, kind, dedupe_key, email_status)
SELECT p.id, k.kind, 'once', 'skipped_pre_launch'
  FROM public.profiles p
 CROSS JOIN (VALUES ('welcome_6h'), ('tips_48h')) AS k(kind)
 WHERE p.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING;

-- NOTE: sending is NOT switched on here. The pg_cron schedule lives in its own
-- migration (…_enable_cron.sql) so that creating the tables is a safe, additive
-- change and starting to mail real students stays a separate, deliberate act.
