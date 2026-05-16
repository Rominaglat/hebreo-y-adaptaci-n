-- Phase 2C followup: migrate community-visibility flags from
-- (the dropped) tenant_memberships into profiles, plus close the two
-- RLS-enabled-but-policyless tables surfaced by the audit.
--
-- Idempotent. Safe to rerun.

BEGIN;

-- 1. Add the privacy flags to profiles if missing.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_in_community boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_phone_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_whatsapp boolean NOT NULL DEFAULT false;

-- 2. Backfill from the backup of tenant_memberships. For users with
--    multiple memberships, OR the flags together (most permissive wins).
UPDATE public.profiles p
SET
  show_in_community = COALESCE(b.show_in_community, p.show_in_community),
  show_phone_call   = COALESCE(b.show_phone_call,   p.show_phone_call),
  show_whatsapp     = COALESCE(b.show_whatsapp,     p.show_whatsapp)
FROM (
  SELECT
    user_id,
    bool_or(show_in_community) AS show_in_community,
    bool_or(show_phone_call)   AS show_phone_call,
    bool_or(show_whatsapp)     AS show_whatsapp
  FROM public._backup_phase2_tenant_memberships
  GROUP BY user_id
) b
WHERE b.user_id = p.id;

-- 3. RLS policies for the two tables the audit flagged as locked.
--    failed_login_attempts is written by the auth flow only — admins read
--    it for security review. rate_limit_buckets is written by edge fns
--    via service role; users can't see anything in it.

ALTER TABLE public.failed_login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS failed_login_attempts_admin_read ON public.failed_login_attempts;
CREATE POLICY failed_login_attempts_admin_read ON public.failed_login_attempts
  FOR SELECT
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limit_buckets_admin_read ON public.rate_limit_buckets;
CREATE POLICY rate_limit_buckets_admin_read ON public.rate_limit_buckets
  FOR SELECT
  USING (is_super_admin(auth.uid()));

COMMIT;
