-- Wave 4 hardening — failed-login tracking, soft-delete, CSP violations log,
-- statement timeouts, and an audit trigger that fires on every role change.
--
-- Idempotent. Apply via Supabase Management API.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS trg_tenant_memberships_role_audit ON public.tenant_memberships;
--   DROP FUNCTION IF EXISTS public.audit_role_change();
--   ALTER ROLE authenticated RESET statement_timeout;
--   ALTER ROLE anon RESET statement_timeout;
--   DROP TABLE IF EXISTS public.csp_violations;
--   DROP FUNCTION IF EXISTS public.record_failed_login(text, text);
--   DROP FUNCTION IF EXISTS public.is_login_locked(text);
--   DROP TABLE IF EXISTS public.failed_login_attempts;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS deleted_at;

-- ── 1. Statement timeouts (low-risk DoS mitigation) ─────────────────────────
-- 30s authenticated / 10s anon. Edge functions run as service_role and are
-- unaffected. (Initial values of 5s / 2s broke the AI assistant chat flow
-- which can exceed 5s under load — relaxed to 30s on 2026-05-13.)
ALTER ROLE authenticated SET statement_timeout = '30s';
ALTER ROLE anon SET statement_timeout = '10s';

-- ── 2. Soft-delete users (audit trail + 30-day undo path) ──────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx
  ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── 3. Failed login tracking (SEC-025 in-app, complements CAPTCHA/WAF) ──────
CREATE TABLE IF NOT EXISTS public.failed_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS failed_login_email_idx
  ON public.failed_login_attempts (email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS failed_login_ip_idx
  ON public.failed_login_attempts (ip, attempted_at DESC);

ALTER TABLE public.failed_login_attempts ENABLE ROW LEVEL SECURITY;
-- No end-user access: only service-role reads/writes (default deny).
DROP POLICY IF EXISTS "failed_login_no_user_access" ON public.failed_login_attempts;

-- Helper functions (service-role only).
CREATE OR REPLACE FUNCTION public.record_failed_login(p_email TEXT, p_ip TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.failed_login_attempts(email, ip)
  VALUES (lower(coalesce(p_email, '')), p_ip);

  -- Garbage collect rows older than 24h to keep the table small.
  DELETE FROM public.failed_login_attempts
  WHERE attempted_at < now() - INTERVAL '24 hours';
END;
$$;

CREATE OR REPLACE FUNCTION public.is_login_locked(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.failed_login_attempts
    WHERE email = lower(coalesce(p_email, ''))
      AND attempted_at > now() - INTERVAL '15 minutes'
    GROUP BY email
    HAVING count(*) >= 5
  );
$$;

REVOKE EXECUTE ON FUNCTION public.record_failed_login(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_login_locked(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_failed_login(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_login_locked(TEXT) TO service_role;

-- ── 4. CSP violations log (browser POSTs to /functions/v1/csp-report) ───────
CREATE TABLE IF NOT EXISTS public.csp_violations (
  id BIGSERIAL PRIMARY KEY,
  document_uri TEXT,
  referrer TEXT,
  directive TEXT,
  blocked_uri TEXT,
  source_file TEXT,
  line_number INT,
  column_number INT,
  script_sample TEXT,
  disposition TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csp_violations_directive_idx
  ON public.csp_violations (directive, created_at DESC);
CREATE INDEX IF NOT EXISTS csp_violations_created_at_idx
  ON public.csp_violations (created_at DESC);

ALTER TABLE public.csp_violations ENABLE ROW LEVEL SECURITY;

-- Super admins can read the violation feed to triage the CSP rollout.
DROP POLICY IF EXISTS "csp_violations_super_admin_read" ON public.csp_violations;
CREATE POLICY "csp_violations_super_admin_read"
  ON public.csp_violations FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = auth.uid() AND m.role = 'super_admin'
    )
  );

-- ── 5. Audit trigger on role changes (catches direct SQL/Dashboard edits) ───
CREATE OR REPLACE FUNCTION public.audit_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role) THEN
    INSERT INTO public.auth_audit_log(actor_id, target_user_id, tenant_id, action, before, after)
    VALUES (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      NEW.user_id,
      NEW.tenant_id,
      'role_change',
      jsonb_build_object('role', OLD.role),
      jsonb_build_object('role', NEW.role)
    );
  ELSIF (TG_OP = 'INSERT' AND NEW.role IN ('admin', 'super_admin')) THEN
    INSERT INTO public.auth_audit_log(actor_id, target_user_id, tenant_id, action, before, after)
    VALUES (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      NEW.user_id,
      NEW.tenant_id,
      'role_grant',
      NULL,
      jsonb_build_object('role', NEW.role)
    );
  ELSIF (TG_OP = 'DELETE' AND OLD.role IN ('admin', 'super_admin')) THEN
    INSERT INTO public.auth_audit_log(actor_id, target_user_id, tenant_id, action, before, after)
    VALUES (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      OLD.user_id,
      OLD.tenant_id,
      'role_revoke',
      jsonb_build_object('role', OLD.role),
      NULL
    );
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_memberships_role_audit ON public.tenant_memberships;
CREATE TRIGGER trg_tenant_memberships_role_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_role_change();
