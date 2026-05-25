-- Brings back the legacy multi-tenant tables/columns that subsequent migrations
-- (pre-phase2c) expect to exist. The phase2c migrations later in the sequence
-- will drop tenant_id columns from data tables, leaving only tenant_settings.
--
-- For a fresh single-tenant Supabase project we still need this scaffolding
-- so the incremental migrations can run without modification.

BEGIN;

-- 1. tenants table — single row, the one and only tenant
CREATE TABLE IF NOT EXISTS public.tenants (
  id          UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.tenants (id, name, slug, is_active)
VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'Romina', 'romina', true)
ON CONFLICT (id) DO NOTHING;

-- 2. tenant_memberships table — bridges users to roles within a tenant.
--    phase2c migrates rows from here into user_roles, then preserves the
--    table for backup. We don't drop it.
CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role            app_role NOT NULL DEFAULT 'student',
  is_default      BOOLEAN NOT NULL DEFAULT true,
  avatar_url      TEXT,
  bio             TEXT,
  full_name       TEXT,
  phone           TEXT,
  show_in_community BOOLEAN DEFAULT false,
  show_phone_call BOOLEAN DEFAULT false,
  show_whatsapp   BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);

-- 3. Add tenant_id column to every existing public table (idempotent loop).
--    phase2c later drops these from data tables, keeping only on
--    tenant_settings + tenant_memberships.
DO $$
DECLARE
  r RECORD;
  default_tenant CONSTANT UUID := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
      AND t.table_name NOT LIKE '\_backup\_%' ESCAPE '\'
      AND t.table_name NOT IN ('tenants', 'tenant_memberships', 'user_roles')
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name   = t.table_name
          AND c.column_name  = 'tenant_id'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN tenant_id UUID NOT NULL DEFAULT %L REFERENCES public.tenants(id) ON DELETE CASCADE',
      r.table_name, default_tenant
    );
  END LOOP;
END $$;

-- 4. Seed tenant_settings singleton row so get_tenant_branding has something
--    to return after the post-add migration.
INSERT INTO public.tenant_settings (id, tenant_id)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000'::uuid
WHERE NOT EXISTS (SELECT 1 FROM public.tenant_settings);

-- 5. Define role-check helper functions early so any migration that runs
--    before phase2c_migrate_roles can reference them. phase2c will replace
--    these with identical signatures that read from user_roles instead.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_instructor(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = _user_id AND role IN ('admin', 'instructor', 'super_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_instructor_in_tenant(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role IN ('admin', 'instructor', 'super_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role IN ('admin', 'super_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  )
$$;

COMMIT;
