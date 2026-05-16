-- Phase 2C — migrate roles + rewrite helpers (idempotent, additive).
-- Drops are NOT in this step; column/table drops come AFTER frontend +
-- edge functions are redeployed against the new helper signatures.

BEGIN;

-- 1. Snapshot tenant_memberships if we haven't already (for rollback insurance).
CREATE TABLE IF NOT EXISTS _backup_phase2c_tenant_memberships AS
  SELECT * FROM public.tenant_memberships;

-- 2. Migrate distinct (user_id, role) pairs from tenant_memberships into
--    user_roles, skipping rows that already exist. Distinct because the
--    same user could have the same role across multiple tenants — collapses
--    to one user_roles row.
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT tm.user_id, tm.role
FROM public.tenant_memberships tm
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = tm.user_id AND ur.role = tm.role
);

-- 3. Rewrite the role helpers to read from user_roles instead of
--    tenant_memberships. has_role / is_super_admin / is_admin_or_instructor
--    keep the same signature so every existing policy and edge function
--    call site stays valid.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_instructor(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'instructor', 'super_admin')
  )
$$;

-- 4. is_tenant_member / is_tenant_admin / is_admin_or_instructor_in_tenant
--    take a tenant_id argument that has no meaning any more. Make them
--    ignore the argument and behave like their non-tenant siblings, so
--    existing call sites that haven't been touched still work until they
--    get cleaned up.

CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tenant_id IS NOT NULL  -- silence linter; param intentionally unused
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','super_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_instructor_in_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','instructor','super_admin'))
$$;

COMMIT;
