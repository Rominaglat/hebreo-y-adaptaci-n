-- Phase 2C destructive — drop tenant_id columns from all data tables,
-- collapse tenant_settings into a singleton, and drop the tenancy tables
-- entirely.
--
-- Insurance: Phase 2A and 2C-prep have already snapshotted tenants,
-- tenant_memberships, tenant_settings, platform_settings into
-- _backup_phase2_* / _backup_phase2c_* tables. The backups stay around
-- until the user manually drops them.
--
-- Rollback: this migration is destructive. To undo, restore from the
-- _backup_phase2_* tables and recreate the FK constraints + RLS policies
-- from the pre-Phase-2A state in git history.

BEGIN;

-- =============================================================================
-- 1. Snapshot platform_settings before we drop it.
-- =============================================================================
CREATE TABLE IF NOT EXISTS _backup_phase2c_platform_settings AS
  SELECT * FROM public.platform_settings;

-- =============================================================================
-- 2. Drop tenant_id from every user-data table.
--    EXCLUDE: the backup tables (whose names start with _backup_),
--    tenant_memberships and tenant_settings (handled below),
--    and the audit-log tables which we keep around but stop scoping.
-- =============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND table_name NOT LIKE '\_backup\_%' ESCAPE '\'
      AND table_name NOT IN ('tenant_memberships', 'tenant_settings')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN tenant_id CASCADE', r.table_name);
  END LOOP;
END $$;

-- =============================================================================
-- 3. Rewrite get_tenant_branding to be singleton-friendly. The arg is
--    kept for source-level compatibility with the existing RPC clients;
--    it's ignored. The return shape is unchanged so the TenantContext
--    destructure keeps working.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_tenant_branding(_tenant_id uuid)
RETURNS TABLE(
  id uuid, tenant_id uuid, logo_url text,
  primary_color text, secondary_color text, accent_color text,
  primary_color_dark text, secondary_color_dark text, accent_color_dark text,
  foreground_color text, foreground_color_dark text,
  background_color text, background_color_dark text,
  custom_css text, api_key text, webhook_url text, webhook_enabled boolean,
  ai_assistant_name text, ai_assistant_avatar_url text, ai_assistant_system_prompt text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id,
    _tenant_id AS tenant_id,  -- echo the arg back for frontend compat
    logo_url,
    primary_color, secondary_color, accent_color,
    primary_color_dark, secondary_color_dark, accent_color_dark,
    foreground_color, foreground_color_dark,
    background_color, background_color_dark,
    custom_css, api_key, webhook_url, webhook_enabled,
    ai_assistant_name, ai_assistant_avatar_url, ai_assistant_system_prompt
  FROM public.tenant_settings
  LIMIT 1;
$$;

-- =============================================================================
-- 4. tenant_settings now operates as a singleton — drop its tenant_id
--    column and the unique constraint that depended on it.
-- =============================================================================
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS tenant_id CASCADE;

-- =============================================================================
-- 5. Drop the tenancy tables.
--    tenant_memberships first (depends on tenants), then tenants, then
--    platform_settings.
-- =============================================================================
DROP TABLE IF EXISTS public.tenant_memberships CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP TABLE IF EXISTS public.platform_settings CASCADE;

-- =============================================================================
-- 6. Drop helper functions that took tenant_id. Their non-tenant
--    siblings (is_super_admin, is_admin_or_instructor, has_role) stay
--    and now read from user_roles (Phase 2C-1 migration).
-- =============================================================================
DROP FUNCTION IF EXISTS public.is_tenant_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_tenant_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_admin_or_instructor_in_tenant(uuid, uuid);

COMMIT;
