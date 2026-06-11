-- Add a 'lead' role tier.
--
-- Leads are sales prospects / preview accounts: they can sign in, see
-- the Courses tab, and view courses they were granted access to — but
-- nothing else. No bot, no calendar, no announcements, no community,
-- no dashboard widgets. The frontend enforces the UI restrictions;
-- this migration just lets the enum hold the value so user_roles rows
-- can be created with role = 'lead'.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lead';

COMMENT ON TYPE public.app_role IS
  'Permission tiers. super_admin > admin > instructor > student > lead. Leads have read-only access to courses they are explicitly enrolled in, and to nothing else (no chat, calendar, community, etc.).';
