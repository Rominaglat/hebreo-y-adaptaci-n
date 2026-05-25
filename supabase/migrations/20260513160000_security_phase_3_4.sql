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

-- ── 2. skill_audit_log section removed — Skills Library feature is not used
--      in this deployment. Original migration scoped skill_audit_log to
--      tenant + applied RLS; skipped here because the table doesn't exist.
