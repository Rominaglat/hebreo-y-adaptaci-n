-- Phase 4 follow-up — Tighten the two USING(true) policies found by the live RLS sweep.
--
-- SEC-030 — event_rsvps "Users can view RSVPs" was USING (true), exposing
--           RSVPs across all tenants. Scope to the caller's tenant via the
--           parent events.tenant_id.
-- SEC-031 — course_instructors "Anyone can view course instructors" was
--           USING (true). Acceptable for course catalog discovery, but we
--           tighten to authenticated users only (no anon).
--
-- Idempotent. Apply via Supabase Management API.
--
-- Rollback:
--   DROP POLICY IF EXISTS "event_rsvps_select_same_tenant" ON public.event_rsvps;
--   DROP POLICY IF EXISTS "course_instructors_authenticated_read" ON public.course_instructors;
--   -- The original policies were named "Users can view RSVPs" and
--   -- "Anyone can view course instructors"; recreate from a backup if needed.

-- ── SEC-030: event_rsvps tenant scoping ────────────────────────────────────
DROP POLICY IF EXISTS "Users can view RSVPs" ON public.event_rsvps;
DROP POLICY IF EXISTS "event_rsvps_select_same_tenant" ON public.event_rsvps;
CREATE POLICY "event_rsvps_select_same_tenant"
  ON public.event_rsvps FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      JOIN public.tenant_memberships m
        ON m.tenant_id = e.tenant_id
       AND m.user_id = auth.uid()
      WHERE e.id = event_rsvps.event_id
    )
  );

-- ── SEC-031: course_instructors authenticated-only read ────────────────────
DROP POLICY IF EXISTS "Anyone can view course instructors" ON public.course_instructors;
DROP POLICY IF EXISTS "course_instructors_authenticated_read" ON public.course_instructors;
CREATE POLICY "course_instructors_authenticated_read"
  ON public.course_instructors FOR SELECT
  USING (auth.uid() IS NOT NULL);
