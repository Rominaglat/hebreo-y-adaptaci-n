-- ============================================================================
-- SEC-CRITICAL: Enable RLS on core public tables + complete policy sets.
--
-- ROOT CAUSE: the base schema + early "security phase" migrations created
-- RLS POLICIES on the core tables (profiles, courses, lessons, enrollments,
-- user_roles, chat_*, ...) but never ran `ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY` on them. With RLS OFF, PostgREST serves every row to the public
-- `anon` key (which ships in the frontend bundle) — a full data breach:
-- all user emails/phones (profiles), private AI chats, the audit trail with
-- IPs, push-subscription secrets, tenant API keys, roles, enrollments, etc.
-- Supabase advisor: rls_disabled_in_public + sensitive_columns_exposed.
--
-- This migration ENABLES RLS on every affected table and fills in the
-- COMPLETE policy set (not just SELECT) so legitimate authenticated flows
-- (push registration, chat, RSVP, viewing own enrollments/notes) keep working.
--
-- `service_role` (edge functions, backend) bypasses RLS entirely — unaffected.
-- Idempotent: safe to re-run.
--
-- ROLLBACK (paste in SQL editor to revert this file):
--   -- Re-disable RLS on the tables enabled below (NOT recommended):
--   -- ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;  (repeat per table)
-- ============================================================================

-- ── CONTENT TABLES: authenticated read, admin/instructor manage ─────────────

-- courses: keep existing published-view SELECT; add admin/instructor manage.
DROP POLICY IF EXISTS courses_admin_manage ON public.courses;
CREATE POLICY courses_admin_manage ON public.courses FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

-- modules: authenticated read, admin/instructor manage.
DROP POLICY IF EXISTS modules_authenticated_read ON public.modules;
CREATE POLICY modules_authenticated_read ON public.modules FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS modules_admin_manage ON public.modules;
CREATE POLICY modules_admin_manage ON public.modules FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

-- lessons: authenticated read but HIDE hidden lessons from students;
-- admin/instructor see all + manage.
DROP POLICY IF EXISTS lessons_authenticated_read ON public.lessons;
CREATE POLICY lessons_authenticated_read ON public.lessons FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (is_hidden = false OR is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  );
DROP POLICY IF EXISTS lessons_admin_manage ON public.lessons;
CREATE POLICY lessons_admin_manage ON public.lessons FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

-- lesson_chunks: keep existing authenticated SELECT; admin manage.
DROP POLICY IF EXISTS lesson_chunks_admin_manage ON public.lesson_chunks;
CREATE POLICY lesson_chunks_admin_manage ON public.lesson_chunks FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.lesson_chunks ENABLE ROW LEVEL SECURITY;

-- exams: authenticated read published; admin/instructor manage.
DROP POLICY IF EXISTS exams_authenticated_read ON public.exams;
CREATE POLICY exams_authenticated_read ON public.exams FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (is_published = true OR is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  );
DROP POLICY IF EXISTS exams_admin_manage ON public.exams;
CREATE POLICY exams_admin_manage ON public.exams FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;

-- exam_questions: contains correct_options (ANSWERS). Students must NOT read
-- this table directly — the get-exam-questions / submit-exam edge functions
-- serve/grade via service_role. Only admin/instructor get direct access.
DROP POLICY IF EXISTS exam_questions_admin_manage ON public.exam_questions;
CREATE POLICY exam_questions_admin_manage ON public.exam_questions FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;

-- announcements: keep existing complex SELECT; add admin/instructor manage.
DROP POLICY IF EXISTS announcements_admin_manage ON public.announcements;
CREATE POLICY announcements_admin_manage ON public.announcements FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- events: keep existing authenticated SELECT; add admin/instructor manage.
DROP POLICY IF EXISTS events_admin_manage ON public.events;
CREATE POLICY events_admin_manage ON public.events FOR ALL TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()))
  WITH CHECK (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- benefit_categories: keep existing (SELECT authed + admin manage).
ALTER TABLE public.benefit_categories ENABLE ROW LEVEL SECURITY;

-- community_benefits: keep existing SELECT; add admin manage.
DROP POLICY IF EXISTS community_benefits_admin_manage ON public.community_benefits;
CREATE POLICY community_benefits_admin_manage ON public.community_benefits FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));
ALTER TABLE public.community_benefits ENABLE ROW LEVEL SECURITY;

-- course_instructors: keep existing authenticated SELECT; add admin manage.
DROP POLICY IF EXISTS course_instructors_admin_manage ON public.course_instructors;
CREATE POLICY course_instructors_admin_manage ON public.course_instructors FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid()));
ALTER TABLE public.course_instructors ENABLE ROW LEVEL SECURITY;

-- study_rooms (legacy): keep existing SELECT; host + admin manage.
DROP POLICY IF EXISTS study_rooms_host_manage ON public.study_rooms;
CREATE POLICY study_rooms_host_manage ON public.study_rooms FOR ALL TO authenticated
  USING (host_id = auth.uid() OR is_super_admin(auth.uid()))
  WITH CHECK (host_id = auth.uid() OR is_super_admin(auth.uid()));
ALTER TABLE public.study_rooms ENABLE ROW LEVEL SECURITY;

-- ── OWNER-SCOPED TABLES: user sees/manages their own rows; admin sees all ────

-- profiles: self read/update, community-visible profiles readable by any
-- authenticated user, admin manages all. Insert-own for the signup trigger path.
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
DROP POLICY IF EXISTS profiles_community_read ON public.profiles;
CREATE POLICY profiles_community_read ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND show_in_community = true);
DROP POLICY IF EXISTS profiles_admin_read ON public.profiles;
CREATE POLICY profiles_admin_read ON public.profiles FOR SELECT TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- user_roles: users may READ their own roles; ONLY admins may change roles
-- (prevents privilege escalation). No self-write.
DROP POLICY IF EXISTS user_roles_self_read ON public.user_roles;
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS user_roles_admin_read ON public.user_roles;
CREATE POLICY user_roles_admin_read ON public.user_roles FOR SELECT TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(),'admin'::app_role));
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- enrollments: keep existing admin/instructor manage-ALL; add student self-read.
DROP POLICY IF EXISTS enrollments_self_read ON public.enrollments;
CREATE POLICY enrollments_self_read ON public.enrollments FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS enrollments_self_progress ON public.enrollments;
CREATE POLICY enrollments_self_progress ON public.enrollments FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

-- chat_conversations: owner-only.
DROP POLICY IF EXISTS chat_conversations_owner ON public.chat_conversations;
CREATE POLICY chat_conversations_owner ON public.chat_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

-- chat_messages: owner via parent conversation.
DROP POLICY IF EXISTS chat_messages_owner ON public.chat_messages;
CREATE POLICY chat_messages_owner ON public.chat_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_conversations c
                 WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.chat_conversations c
                 WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()));
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- user_notes: owner-only + admin read.
DROP POLICY IF EXISTS user_notes_owner ON public.user_notes;
CREATE POLICY user_notes_owner ON public.user_notes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS user_notes_admin_read ON public.user_notes;
CREATE POLICY user_notes_admin_read ON public.user_notes FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()));
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

-- user_activities: owner reads own, admin reads all, user may insert own.
DROP POLICY IF EXISTS user_activities_self_read ON public.user_activities;
CREATE POLICY user_activities_self_read ON public.user_activities FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS user_activities_admin_read ON public.user_activities;
CREATE POLICY user_activities_admin_read ON public.user_activities FOR SELECT TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
DROP POLICY IF EXISTS user_activities_self_insert ON public.user_activities;
CREATE POLICY user_activities_self_insert ON public.user_activities FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;

-- exam_attempts: owner-only (submit-exam edge fn uses service_role) + admin read.
DROP POLICY IF EXISTS exam_attempts_owner ON public.exam_attempts;
CREATE POLICY exam_attempts_owner ON public.exam_attempts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS exam_attempts_admin_read ON public.exam_attempts;
CREATE POLICY exam_attempts_admin_read ON public.exam_attempts FOR SELECT TO authenticated
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;

-- event_rsvps: keep existing authenticated SELECT; add self manage.
DROP POLICY IF EXISTS event_rsvps_self_manage ON public.event_rsvps;
CREATE POLICY event_rsvps_self_manage ON public.event_rsvps FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

-- push_subscriptions: keep existing admin SELECT; add self manage (register/remove).
DROP POLICY IF EXISTS push_subscriptions_self_manage ON public.push_subscriptions;
CREATE POLICY push_subscriptions_self_manage ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- benefit_clicks: analytics — authenticated may insert own; admin reads.
DROP POLICY IF EXISTS benefit_clicks_self_insert ON public.benefit_clicks;
CREATE POLICY benefit_clicks_self_insert ON public.benefit_clicks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
DROP POLICY IF EXISTS benefit_clicks_admin_read ON public.benefit_clicks;
CREATE POLICY benefit_clicks_admin_read ON public.benefit_clicks FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));
ALTER TABLE public.benefit_clicks ENABLE ROW LEVEL SECURITY;

-- ── SECRET / INTERNAL TABLES: admin or service_role only ────────────────────

-- developer_settings: holds api_key + webhook_signing_secret. Admin only.
DROP POLICY IF EXISTS developer_settings_admin ON public.developer_settings;
CREATE POLICY developer_settings_admin ON public.developer_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));
ALTER TABLE public.developer_settings ENABLE ROW LEVEL SECURITY;

-- api_request_logs: internal (api_key_hash, IPs). No client policy -> service_role only.
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;

-- tenant_settings: enable RLS. Existing policies already restrict SELECT/UPDATE
-- to admins. Non-admins get NOTHING from the base table (this is what stops
-- api_key / vimeo_access_token / webhook_url leaking). Student branding is NOT
-- affected: it is served by the get_tenant_branding() SECURITY DEFINER RPC.
-- Add an admin INSERT policy (first-time settings creation) since only SELECT
-- and UPDATE policies existed.
DROP POLICY IF EXISTS tenant_settings_admin_insert ON public.tenant_settings;
CREATE POLICY tenant_settings_admin_insert ON public.tenant_settings FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR is_super_admin(auth.uid()));
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

-- CRITICAL: get_tenant_branding() is a SECURITY DEFINER RPC granted to anon.
-- It returned api_key / webhook_url / webhook_enabled to ANY caller (a full
-- secret leak that bypasses RLS). The frontend already discards those fields,
-- so we keep the exact return signature but hard-NULL the secret columns.
CREATE OR REPLACE FUNCTION public.get_tenant_branding(_tenant_id uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, logo_url text, primary_color text, secondary_color text, accent_color text, primary_color_dark text, secondary_color_dark text, accent_color_dark text, foreground_color text, foreground_color_dark text, background_color text, background_color_dark text, custom_css text, api_key text, webhook_url text, webhook_enabled boolean, ai_assistant_name text, ai_assistant_avatar_url text, ai_assistant_system_prompt text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    id,
    _tenant_id AS tenant_id,
    logo_url,
    primary_color, secondary_color, accent_color,
    primary_color_dark, secondary_color_dark, accent_color_dark,
    foreground_color, foreground_color_dark,
    background_color, background_color_dark,
    custom_css,
    NULL::text  AS api_key,          -- was leaking the tenant API key
    NULL::text  AS webhook_url,       -- was leaking the webhook URL
    NULL::boolean AS webhook_enabled,
    ai_assistant_name, ai_assistant_avatar_url, ai_assistant_system_prompt
  FROM public.tenant_settings
  LIMIT 1;
$function$;

-- ── LEFTOVER BACKUP TABLES: lock to service_role only (contain old tenant data)
ALTER TABLE public._backup_phase2_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_phase2_tenant_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_phase2_tenants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_phase2c_tenant_memberships ENABLE ROW LEVEL SECURITY;
