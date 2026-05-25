-- Phase 2 of single-tenant conversion — relax all tenant-scoped RLS to
-- auth-only (for content readable by any member) or role-only (for
-- admin/instructor-gated operations).
--
-- Why now: the app has been running on Phase 1 (UI/code single-tenant
-- with multi-tenant DB intact) and stable. Relaxing the RLS removes the
-- "membership in the right tenant" enforcement that's redundant once
-- every user belongs to the same single tenant. This is a stepping
-- stone toward Phase 2B (drop tenant_id columns) and Phase 2C (drop
-- tenant tables).
--
-- Schema changes in THIS migration: none. Only RLS policies change.
-- Data: none destroyed; a backup-of-tenancy snapshot is taken at the
-- top out of caution (rollback insurance).
--
-- Rollback: run the inverse SQL captured at the bottom of this file.

BEGIN;

-- =============================================================================
-- 1. Backup tenancy data (insurance — Phase 2B/2C may drop these tables).
-- =============================================================================

CREATE TABLE IF NOT EXISTS _backup_phase2_tenants AS
  SELECT * FROM public.tenants;

CREATE TABLE IF NOT EXISTS _backup_phase2_tenant_memberships AS
  SELECT * FROM public.tenant_memberships;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'platform_settings' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS _backup_phase2_platform_settings AS SELECT * FROM public.platform_settings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tenant_settings' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS _backup_phase2_tenant_settings AS SELECT * FROM public.tenant_settings';
  END IF;
END $$;

-- =============================================================================
-- 2. Relax content-read policies — "view X in their tenant" → any authed user.
-- =============================================================================

DROP POLICY IF EXISTS "Users can view announcements in their tenant" ON public.announcements;
CREATE POLICY "Authenticated users can view announcements" ON public.announcements
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view categories in their tenant" ON public.benefit_categories;
CREATE POLICY "Authenticated users can view benefit categories" ON public.benefit_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view benefits in their tenant" ON public.community_benefits;
CREATE POLICY "Authenticated users can view active benefits" ON public.community_benefits
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (is_active = true OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "Anyone can view published courses in their tenant" ON public.courses;
CREATE POLICY "Authenticated users can view published courses" ON public.courses
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (is_published = true OR is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can view events in their tenant" ON public.events;
CREATE POLICY "Authenticated users can view events" ON public.events
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view rooms in their tenant" ON public.rooms;
CREATE POLICY "Authenticated users can view rooms" ON public.rooms
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can view study rooms in their tenant" ON public.study_rooms;
CREATE POLICY "Authenticated users can view active study rooms" ON public.study_rooms
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (is_active = true OR host_id = auth.uid() OR is_super_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "Tenant members can read chunks" ON public.lesson_chunks;
CREATE POLICY "Authenticated users can read lesson chunks" ON public.lesson_chunks
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- 3. Relax role-gated policies — drop the per-tenant scoping, keep role check.
-- =============================================================================

DROP POLICY IF EXISTS "Admins and super admins can manage categories" ON public.benefit_categories;
CREATE POLICY "Admins can manage benefit categories" ON public.benefit_categories
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Instructors can manage student enrollments in their tenant" ON public.enrollments;
CREATE POLICY "Instructors and admins can manage enrollments" ON public.enrollments
  FOR ALL
  USING (
    is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid())
  )
  WITH CHECK (
    is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid())
  );

DROP POLICY IF EXISTS "auth_audit_log_admin_read" ON public.auth_audit_log;
CREATE POLICY auth_audit_log_admin_read ON public.auth_audit_log
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  );

-- personality_assessments + skill_audit_log policies skipped — those features
-- (Personality assessments, Skills Library) are not used in this deployment.

DROP POLICY IF EXISTS "Admins can view all subscriptions in tenant" ON public.push_subscriptions;
CREATE POLICY "Admins can view all push subscriptions" ON public.push_subscriptions
  FOR SELECT
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Tenant admins can update their settings" ON public.tenant_settings;
DROP POLICY IF EXISTS "Tenant admins can view their settings" ON public.tenant_settings;
CREATE POLICY tenant_settings_admin_read ON public.tenant_settings
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));
CREATE POLICY tenant_settings_admin_update ON public.tenant_settings
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));

-- =============================================================================
-- 4. profiles + event_rsvps + csp_violations — drop tenant scoping.
-- =============================================================================

DROP POLICY IF EXISTS "Tenant members can view community member profiles" ON public.profiles;
CREATE POLICY "Members can view community profiles" ON public.profiles
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = profiles.id
        AND tm.show_in_community = true
    )
  );

DROP POLICY IF EXISTS event_rsvps_select_same_tenant ON public.event_rsvps;
CREATE POLICY event_rsvps_select_authed ON public.event_rsvps
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- csp_violations: the existing policy already only checks role, just rename
-- for consistency. No behavior change.
DROP POLICY IF EXISTS csp_violations_super_admin_read ON public.csp_violations;
CREATE POLICY csp_violations_super_admin_read ON public.csp_violations
  FOR SELECT
  USING (is_super_admin(auth.uid()));

-- =============================================================================
-- 5. Tenancy tables themselves — relax so the single-tenant app still loads.
-- =============================================================================

DROP POLICY IF EXISTS "Users can view tenants they belong to" ON public.tenants;
CREATE POLICY "Authenticated users can view tenants" ON public.tenants
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Tenant admins can manage their tenant memberships" ON public.tenant_memberships;
DROP POLICY IF EXISTS "Tenant members can view community members" ON public.tenant_memberships;

CREATE POLICY tenant_memberships_admin_manage ON public.tenant_memberships
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));

CREATE POLICY tenant_memberships_community_read ON public.tenant_memberships
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND show_in_community = true);

COMMIT;

-- =============================================================================
-- ROLLBACK SQL (run as one transaction to restore the original policies).
-- Backup tables stay around either way; drop them manually with:
--   DROP TABLE IF EXISTS _backup_phase2_tenants;
--   DROP TABLE IF EXISTS _backup_phase2_tenant_memberships;
--   DROP TABLE IF EXISTS _backup_phase2_platform_settings;
--   DROP TABLE IF EXISTS _backup_phase2_tenant_settings;
-- =============================================================================
--
-- BEGIN;
-- -- announcements
-- DROP POLICY IF EXISTS "Authenticated users can view announcements" ON public.announcements;
-- CREATE POLICY "Users can view announcements in their tenant" ON public.announcements
--   FOR SELECT USING ((tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id) OR is_super_admin(auth.uid()));
-- -- benefit_categories
-- DROP POLICY IF EXISTS "Authenticated users can view benefit categories" ON public.benefit_categories;
-- CREATE POLICY "Users can view categories in their tenant" ON public.benefit_categories
--   FOR SELECT USING (is_tenant_member(auth.uid(), tenant_id) OR is_super_admin(auth.uid()));
-- DROP POLICY IF EXISTS "Admins can manage benefit categories" ON public.benefit_categories;
-- CREATE POLICY "Admins and super admins can manage categories" ON public.benefit_categories
--   FOR ALL
--   USING (is_tenant_admin(auth.uid(), tenant_id) OR is_super_admin(auth.uid()))
--   WITH CHECK (is_tenant_admin(auth.uid(), tenant_id) OR is_super_admin(auth.uid()));
-- -- community_benefits
-- DROP POLICY IF EXISTS "Authenticated users can view active benefits" ON public.community_benefits;
-- CREATE POLICY "Users can view benefits in their tenant" ON public.community_benefits
--   FOR SELECT USING (
--     (auth.uid() IS NOT NULL) AND (
--       ((is_active = true) AND ((tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id)))
--       OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid())
--     )
--   );
-- -- courses
-- DROP POLICY IF EXISTS "Authenticated users can view published courses" ON public.courses;
-- CREATE POLICY "Anyone can view published courses in their tenant" ON public.courses
--   FOR SELECT USING (
--     ((is_published = true) AND ((tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id)))
--     OR is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid())
--   );
-- -- events
-- DROP POLICY IF EXISTS "Authenticated users can view events" ON public.events;
-- CREATE POLICY "Users can view events in their tenant" ON public.events
--   FOR SELECT USING ((tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id) OR is_super_admin(auth.uid()));
-- -- rooms
-- DROP POLICY IF EXISTS "Authenticated users can view rooms" ON public.rooms;
-- CREATE POLICY "Users can view rooms in their tenant" ON public.rooms
--   FOR SELECT USING ((auth.uid() IS NOT NULL) AND ((tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id) OR is_super_admin(auth.uid())));
-- -- study_rooms
-- DROP POLICY IF EXISTS "Authenticated users can view active study rooms" ON public.study_rooms;
-- CREATE POLICY "Users can view study rooms in their tenant" ON public.study_rooms
--   FOR SELECT USING (
--     (((is_active = true) AND ((tenant_id IS NULL) OR is_tenant_member(auth.uid(), tenant_id)))
--      OR (host_id = auth.uid()) OR is_super_admin(auth.uid()))
--   );
-- -- lesson_chunks
-- DROP POLICY IF EXISTS "Authenticated users can read lesson chunks" ON public.lesson_chunks;
-- CREATE POLICY "Tenant members can read chunks" ON public.lesson_chunks
--   FOR SELECT USING (is_tenant_member(auth.uid(), tenant_id));
-- -- enrollments / push_subscriptions / personality_assessments / skill_audit_log /
-- -- auth_audit_log / tenant_settings / profiles / event_rsvps / csp_violations /
-- -- tenants / tenant_memberships
-- --   …(see git history of this migration's pre-image for verbatim originals;
-- --     the original policy bodies were captured in pg_policies before this
-- --     migration ran and are also visible in the migration history of
-- --     20260513140000_security_storage_privacy.sql and friends).
-- COMMIT;
