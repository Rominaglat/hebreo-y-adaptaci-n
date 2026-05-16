-- AI Assistant per-tenant customization
-- Allows admins to set the assistant's display name, avatar image, and an
-- optional system prompt that's injected into every conversation.

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS ai_assistant_name text,
  ADD COLUMN IF NOT EXISTS ai_assistant_avatar_url text,
  ADD COLUMN IF NOT EXISTS ai_assistant_system_prompt text;

COMMENT ON COLUMN public.tenant_settings.ai_assistant_name IS 'Display name shown in the floating chat (e.g. "ג''ייסון", "Aria")';
COMMENT ON COLUMN public.tenant_settings.ai_assistant_avatar_url IS 'Public URL to the assistant avatar image (cropped square)';
COMMENT ON COLUMN public.tenant_settings.ai_assistant_system_prompt IS 'Optional system prompt prepended to every AI conversation for this tenant';

-- Update the get_tenant_branding RPC to include the new columns
DROP FUNCTION IF EXISTS public.get_tenant_branding(uuid);
CREATE OR REPLACE FUNCTION public.get_tenant_branding(_tenant_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  logo_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  primary_color_dark text,
  secondary_color_dark text,
  accent_color_dark text,
  foreground_color text,
  foreground_color_dark text,
  background_color text,
  background_color_dark text,
  custom_css text,
  api_key text,
  webhook_url text,
  webhook_enabled boolean,
  ai_assistant_name text,
  ai_assistant_avatar_url text,
  ai_assistant_system_prompt text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    tenant_id,
    logo_url,
    primary_color,
    secondary_color,
    accent_color,
    primary_color_dark,
    secondary_color_dark,
    accent_color_dark,
    foreground_color,
    foreground_color_dark,
    background_color,
    background_color_dark,
    custom_css,
    api_key,
    webhook_url,
    webhook_enabled,
    ai_assistant_name,
    ai_assistant_avatar_url,
    ai_assistant_system_prompt
  FROM public.tenant_settings
  WHERE tenant_id = _tenant_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_branding(uuid) TO authenticated, anon;
