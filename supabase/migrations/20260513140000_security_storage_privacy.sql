-- SEC-021 + SEC-029 — Lock down sensitive storage buckets.
--
-- 1. New private bucket `transcripts` for lecture transcripts. transcribe-lesson
--    will be updated (Phase 2.2 SSRF PR) to upload here instead of the public
--    `course-images` bucket.
-- 2. Private bucket `skill-files` for uploaded skill content (already exists in
--    practice via skill-submit but bucket privacy is verified here).
-- 3. RLS policies on storage.objects so authenticated users in the same tenant
--    can read transcripts and skills, but anon cannot.
--
-- Idempotent: re-runnable. Each policy is dropped before recreating.
-- Apply via the Supabase Management API SQL endpoint (see deploy runbook).
--
-- Rollback (paste in Studio if you need to revert):
--   DELETE FROM storage.buckets WHERE id = 'transcripts';
--   UPDATE storage.buckets SET public = true WHERE id = 'skill-files';
--   DROP POLICY IF EXISTS "transcripts_tenant_read" ON storage.objects;
--   DROP POLICY IF EXISTS "transcripts_service_write" ON storage.objects;
--   DROP POLICY IF EXISTS "skill_files_authenticated_read" ON storage.objects;

-- ── 1. Create transcripts bucket (private) ──────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('transcripts', 'transcripts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── 2. Ensure skill-files is private ────────────────────────────────────────
-- Created by an earlier migration; we just confirm privacy here.
UPDATE storage.buckets SET public = false WHERE id = 'skill-files';

-- ── 3. RLS policies on storage.objects for transcripts ──────────────────────
-- Path convention: transcripts/<tenant_id>/<lesson_id>/<file>.ext
-- Tenant id is parsed from the second path segment.
DROP POLICY IF EXISTS "transcripts_tenant_read" ON storage.objects;
CREATE POLICY "transcripts_tenant_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'transcripts'
    AND auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_memberships m
        WHERE m.user_id = auth.uid()
          AND m.tenant_id::text = (storage.foldername(name))[1]
      )
    )
  );

-- Service-role (used by edge functions like transcribe-lesson) bypasses RLS by
-- default. No explicit write policy needed — anon writes are denied by absence
-- of any INSERT/UPDATE policy.
DROP POLICY IF EXISTS "transcripts_service_write" ON storage.objects;
-- (intentional no-op: keeping the DROP for idempotent rollback symmetry)

-- ── 4. RLS policies on storage.objects for skill-files ──────────────────────
-- skill-files holds approved + draft skill content. Authenticated users may
-- read approved skills (Layer 1: enforced via the public.skills row's status).
-- For simplicity we let any authenticated user read; the edge function
-- skill-admin-actions surfaces only approved content. Tighten further if
-- skills become tenant-scoped (currently they are global).
DROP POLICY IF EXISTS "skill_files_authenticated_read" ON storage.objects;
CREATE POLICY "skill_files_authenticated_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'skill-files'
    AND auth.uid() IS NOT NULL
  );
