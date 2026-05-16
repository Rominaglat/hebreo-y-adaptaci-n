-- Phase 3 / Phase 4 — Auth audit log + skill_audit_log tenant scoping.
--
--   - SEC-026: new `auth_audit_log` table that records admin actions on users
--     (create / delete / role-change / reset_password). Tenant-scoped RLS so
--     admins only see actions inside their own tenant.
--   - SEC-015: add `tenant_id` to `skill_audit_log`, backfill from the
--     associated skill, and tighten the SELECT policy to be tenant-scoped.
--     Skills themselves are still global (per the existing data model); the
--     audit trail is scoped to the tenant that triggered the action via the
--     admin's tenant_memberships.
--
-- Idempotent. Apply via Supabase Management API.
--
-- Rollback:
--   DROP POLICY IF EXISTS "auth_audit_log_admin_read" ON public.auth_audit_log;
--   DROP TABLE IF EXISTS public.auth_audit_log;
--   DROP POLICY IF EXISTS "skill_audit_log_tenant_admin_read" ON public.skill_audit_log;
--   ALTER TABLE public.skill_audit_log DROP COLUMN IF EXISTS tenant_id;
--   -- restore the previous global admin-read policy here if needed.

-- ── 1. auth_audit_log (SEC-026) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  target_user_id UUID,
  tenant_id UUID,
  action TEXT NOT NULL,
  before JSONB,
  after JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_audit_log_tenant_id_idx
  ON public.auth_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_log_actor_idx
  ON public.auth_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_log_target_idx
  ON public.auth_audit_log (target_user_id, created_at DESC);

ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;

-- Tenant admins (and super_admins) read the log entries for their tenant only.
-- Service-role writes; no end-user INSERT path is needed.
DROP POLICY IF EXISTS "auth_audit_log_admin_read" ON public.auth_audit_log;
CREATE POLICY "auth_audit_log_admin_read"
  ON public.auth_audit_log FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = auth.uid()
        AND m.tenant_id = public.auth_audit_log.tenant_id
        AND m.role IN ('admin', 'super_admin')
    )
  );

-- ── 2. skill_audit_log tenant scoping (SEC-015) ─────────────────────────────
ALTER TABLE public.skill_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Best-effort backfill: derive tenant_id from the actor's tenant_memberships.
-- The skill_audit_log column is `actor_id` (not user_id) — the admin who
-- performed the action. Skills themselves are global, so we use the actor's
-- admin tenant at audit time as the scoping signal. Rows whose actor has no
-- admin membership (deleted, demoted) remain NULL and are visible only to
-- super_admin via the fallback policy below.
UPDATE public.skill_audit_log al
SET tenant_id = (
  SELECT m.tenant_id
  FROM public.tenant_memberships m
  WHERE m.user_id = al.actor_id
    AND m.role IN ('admin', 'super_admin')
  LIMIT 1
)
WHERE al.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS skill_audit_log_tenant_id_idx
  ON public.skill_audit_log (tenant_id, created_at DESC);

-- Drop the old global admin policy (if it exists under either name)
DROP POLICY IF EXISTS "Admins can view audit log" ON public.skill_audit_log;
DROP POLICY IF EXISTS "skill_audit_log_admin_read" ON public.skill_audit_log;
DROP POLICY IF EXISTS "skill_audit_log_tenant_admin_read" ON public.skill_audit_log;
DROP POLICY IF EXISTS "skill_audit_log_super_admin_read" ON public.skill_audit_log;

CREATE POLICY "skill_audit_log_tenant_admin_read"
  ON public.skill_audit_log FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = auth.uid()
        AND m.tenant_id = public.skill_audit_log.tenant_id
        AND m.role IN ('admin', 'super_admin')
    )
  );

-- Super-admins still see globally-scoped (NULL tenant_id) historical entries.
CREATE POLICY "skill_audit_log_super_admin_read"
  ON public.skill_audit_log FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = auth.uid()
        AND m.role = 'super_admin'
    )
  );
