-- =============================================================================
-- Baseline schema migration
-- Generated from src/integrations/supabase/types.ts
-- Purpose: Create the base tables that the 26 incremental migrations
--          (starting 2026-03-04) expect to already exist.
--
-- Deliberately ordered BEFORE all existing migrations via the timestamp prefix.
-- Defensive: CREATE TABLE IF NOT EXISTS so subsequent migrations that may
-- attempt to recreate are no-ops.
--
-- Excluded tables (created by later migrations or out of scope):
--   - _backup_* (legacy phase backups, no longer used)
--   - skills, skill_versions, skill_ratings, skill_downloads (Skills Library)
--   - skill_audit_log (created by 20260408150000_create_skill_audit_log.sql)
--   - learning_paths   (created by 20260408120000_create_learning_paths.sql)
--   - personality_assessments (created by 20260507120000_create_personality_assessments.sql)
--   - lesson_bookmarks (created by 20260304154700_create_lesson_bookmarks.sql)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Required extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 2. Enum types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'instructor', 'student', 'super_admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Base tables
-- ---------------------------------------------------------------------------

-- announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID, -- references auth.users(id)
  content TEXT NOT NULL,
  title TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- api_request_logs
CREATE TABLE IF NOT EXISTS public.api_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_message TEXT,
  ip_address TEXT,
  request_data JSONB,
  response_time_ms INTEGER,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- auth_audit_log
CREATE TABLE IF NOT EXISTS public.auth_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_id UUID NOT NULL, -- references auth.users(id)
  target_user_id UUID,    -- references auth.users(id)
  before JSONB,
  after JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- benefit_categories
CREATE TABLE IF NOT EXISTS public.benefit_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value TEXT NOT NULL,
  label_en TEXT NOT NULL,
  label_he TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by UUID, -- references auth.users(id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- community_benefits (created before benefit_clicks since FK targets it)
CREATE TABLE IF NOT EXISTS public.community_benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  link_url TEXT,
  logo_url TEXT,
  phone_number TEXT,
  created_by UUID, -- references auth.users(id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- benefit_clicks (FK -> community_benefits)
CREATE TABLE IF NOT EXISTS public.benefit_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id UUID NOT NULL REFERENCES public.community_benefits(id) ON DELETE CASCADE,
  click_type TEXT NOT NULL,
  user_id UUID, -- references auth.users(id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- chat_conversations
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL, -- references auth.users(id)
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- chat_messages (FK -> chat_conversations)
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  role TEXT NOT NULL,
  sources JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- courses (referenced by many other tables; create early)
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  instructor_id UUID, -- references auth.users(id) / profiles(id)
  is_published BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER,
  payment_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profiles (referenced by other tables; create early)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY, -- mirrors auth.users(id)
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  phone TEXT,
  join_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  show_in_community BOOLEAN,
  show_phone_call BOOLEAN,
  show_whatsapp BOOLEAN,
  social_links JSONB,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- course_instructors (FK -> courses, profiles)
CREATE TABLE IF NOT EXISTS public.course_instructors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  instructor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- csp_violations
CREATE TABLE IF NOT EXISTS public.csp_violations (
  id BIGSERIAL PRIMARY KEY,
  blocked_uri TEXT,
  column_number INTEGER,
  directive TEXT,
  disposition TEXT,
  document_uri TEXT,
  ip_address TEXT,
  line_number INTEGER,
  referrer TEXT,
  script_sample TEXT,
  source_file TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- developer_settings
CREATE TABLE IF NOT EXISTS public.developer_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL DEFAULT '',
  api_key_created_at TIMESTAMPTZ,
  rate_limit_enabled BOOLEAN,
  rate_limit_per_minute INTEGER,
  updated_by UUID, -- references auth.users(id)
  webhook_enabled BOOLEAN,
  webhook_signing_secret TEXT,
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- enrollments (FK -> courses)
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  progress_percentage NUMERIC NOT NULL DEFAULT 0,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- events (created before event_rsvps)
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  meeting_url TEXT,
  google_event_id TEXT,
  created_by UUID, -- references auth.users(id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- event_rsvps (FK -> events)
CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  status TEXT NOT NULL DEFAULT 'going',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- exams (FK -> courses; created before exam_attempts/exam_questions/lessons)
CREATE TABLE IF NOT EXISTS public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0,
  passing_score INTEGER NOT NULL DEFAULT 0,
  time_limit_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- exam_attempts (FK -> exams)
CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  passed BOOLEAN,
  score NUMERIC,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- exam_questions (FK -> exams)
CREATE TABLE IF NOT EXISTS public.exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'multiple_choice',
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  explanation TEXT,
  image_url TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- failed_login_attempts
CREATE TABLE IF NOT EXISTS public.failed_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- modules (FK -> courses)
CREATE TABLE IF NOT EXISTS public.modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- lessons (FK -> modules, exams)
CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  exam_id UUID REFERENCES public.exams(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  lesson_type TEXT NOT NULL DEFAULT 'video',
  content_text TEXT,
  duration_minutes INTEGER,
  embed_url TEXT,
  file_url TEXT,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  order_index INTEGER NOT NULL DEFAULT 0,
  resources_url TEXT,
  video_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- lesson_chunks (FK -> lessons, modules, courses are referenced but no explicit FK in types.ts Relationships)
CREATE TABLE IF NOT EXISTS public.lesson_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL, -- references lessons(id)
  module_id UUID NOT NULL, -- references modules(id)
  course_id UUID NOT NULL, -- references courses(id)
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_type TEXT NOT NULL DEFAULT 'lesson',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- lesson_completions (FK -> lessons)
CREATE TABLE IF NOT EXISTS public.lesson_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- push_subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL, -- references auth.users(id)
  endpoint TEXT NOT NULL,
  auth TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rate_limit_buckets (composite/no surrogate id in types.ts; key is natural PK)
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- rooms (created before room_messages, room_participants, webrtc_signals)
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  host_id UUID, -- references auth.users(id)
  host_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  is_live BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  is_recording BOOLEAN NOT NULL DEFAULT false,
  max_participants INTEGER NOT NULL DEFAULT 10,
  recording_url TEXT,
  shared_video_state JSONB,
  shared_video_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- room_messages (FK -> rooms)
CREATE TABLE IF NOT EXISTS public.room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  user_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- room_participants (FK -> rooms)
CREATE TABLE IF NOT EXISTS public.room_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  user_name TEXT NOT NULL,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  is_screen_sharing BOOLEAN NOT NULL DEFAULT false,
  is_video_on BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- study_rooms
CREATE TABLE IF NOT EXISTS public.study_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL, -- references auth.users(id)
  room_name TEXT NOT NULL,
  room_url TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_invite_only BOOLEAN NOT NULL DEFAULT false,
  max_participants INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenant_settings
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accent_color TEXT,
  accent_color_dark TEXT,
  ai_assistant_avatar_url TEXT,
  ai_assistant_name TEXT,
  ai_assistant_system_prompt TEXT,
  api_key TEXT,
  api_key_created_at TIMESTAMPTZ,
  background_color TEXT,
  background_color_dark TEXT,
  custom_css TEXT,
  foreground_color TEXT,
  foreground_color_dark TEXT,
  logo_url TEXT,
  primary_color TEXT,
  primary_color_dark TEXT,
  secondary_color TEXT,
  secondary_color_dark TEXT,
  vimeo_access_token TEXT,
  webhook_enabled BOOLEAN,
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_activities
CREATE TABLE IF NOT EXISTS public.user_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL, -- references auth.users(id)
  activity_type TEXT NOT NULL,
  description TEXT NOT NULL,
  action TEXT,
  entity_id UUID,
  entity_type TEXT,
  ip_address TEXT,
  metadata JSONB,
  new_values JSONB,
  old_values JSONB,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_notes (FK -> lessons)
CREATE TABLE IF NOT EXISTS public.user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, -- references auth.users(id)
  note_text TEXT NOT NULL,
  video_timestamp NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL, -- references auth.users(id)
  role public.app_role NOT NULL DEFAULT 'student'
);

-- webrtc_signals (FK -> rooms)
CREATE TABLE IF NOT EXISTS public.webrtc_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  from_user UUID NOT NULL, -- references auth.users(id)
  to_user UUID NOT NULL,   -- references auth.users(id)
  signal_data JSONB NOT NULL,
  signal_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
