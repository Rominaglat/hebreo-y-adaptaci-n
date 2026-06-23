-- Time-limited user access.
--
-- A user can be granted access that expires after a set time. When it
-- expires, a server-side sweep removes their access to ALL content
-- (deletes their enrollments) and downgrades them to the 'lead' role.
--
-- Two writers set the limit (both via service-role edge functions):
--   * external-api  → users.create with an optional `access_hours` field
--   * admin-user-actions → `set_access_limit` (from the Manage Users UI)
--
-- The sweep itself is pure SQL invoked by pg_cron — no edge function /
-- pg_net hop needed (unlike cleanup-empty-rooms, whose logic lived in TS).

BEGIN;

-- =============================================================================
-- 1. access_limits — one active limit per user.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.access_limits (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,                          -- NULL = pending; set once the sweep processed it
  created_by UUID,                                 -- admin who set it; NULL when set via API
  source     TEXT NOT NULL DEFAULT 'admin',        -- 'api' | 'admin'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the sweep scan: WHERE expires_at <= now() AND revoked_at IS NULL.
CREATE INDEX IF NOT EXISTS access_limits_pending_idx
  ON public.access_limits (expires_at)
  WHERE revoked_at IS NULL;

-- =============================================================================
-- 2. RLS — admins/instructors may read (to show the limit + badge in the UI).
--    All writes go through service-role edge functions, which bypass RLS.
-- =============================================================================
ALTER TABLE public.access_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and instructors can read access_limits" ON public.access_limits;
CREATE POLICY "Admins and instructors can read access_limits"
  ON public.access_limits FOR SELECT
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));

-- =============================================================================
-- 3. revoke_expired_access() — the sweep. Returns the number of users it
--    downgraded. SECURITY DEFINER so it can mutate roles/enrollments
--    regardless of the (service-role / cron) caller.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.revoke_expired_access()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  processed integer := 0;
BEGIN
  FOR r IN
    SELECT al.user_id
    FROM public.access_limits al
    WHERE al.expires_at <= now()
      AND al.revoked_at IS NULL
  LOOP
    -- Defensive guard: never downgrade a privileged account, even if a
    -- limit row somehow exists for one. Mark it handled so it stops
    -- showing up in the scan.
    IF EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = r.user_id
        AND ur.role IN ('admin', 'super_admin', 'instructor')
    ) THEN
      UPDATE public.access_limits
        SET revoked_at = now(), updated_at = now()
        WHERE user_id = r.user_id;
      CONTINUE;
    END IF;

    -- Each mutation below re-checks the privileged predicate inside its OWN
    -- statement snapshot. This closes the check-then-act race: if a role
    -- promotion commits between the guard above and these statements, the
    -- NOT EXISTS sees it and the mutation no-ops, so a privileged account is
    -- never clobbered.

    -- 1. Remove access to all content.
    DELETE FROM public.enrollments e
    WHERE e.user_id = r.user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = r.user_id
          AND ur.role IN ('admin', 'super_admin', 'instructor')
      );

    -- 2. Downgrade to lead (replace every role row with a single 'lead').
    DELETE FROM public.user_roles ur
    WHERE ur.user_id = r.user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles p
        WHERE p.user_id = r.user_id
          AND p.role IN ('admin', 'super_admin', 'instructor')
      );

    INSERT INTO public.user_roles (user_id, role)
    SELECT r.user_id, 'lead'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles p
      WHERE p.user_id = r.user_id
        AND p.role IN ('admin', 'super_admin', 'instructor')
    );

    -- 3. Mark processed.
    UPDATE public.access_limits
      SET revoked_at = now(), updated_at = now()
      WHERE user_id = r.user_id;

    processed := processed + 1;
  END LOOP;

  RETURN processed;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_expired_access() FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- 4. Schedule the sweep via pg_cron every 10 minutes. Mirrors the
--    invoke-cleanup-empty-rooms guard pattern, but runs pure SQL.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM 1 FROM cron.job WHERE jobname = 'invoke-revoke-expired-access';
    IF NOT FOUND THEN
      PERFORM cron.schedule(
        'invoke-revoke-expired-access',
        '*/10 * * * *',
        $cron$SELECT public.revoke_expired_access();$cron$
      );
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not enabled — skipping revoke-expired-access schedule.';
  END IF;
END$$;
