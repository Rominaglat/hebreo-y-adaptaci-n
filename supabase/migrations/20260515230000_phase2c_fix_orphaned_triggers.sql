-- Phase 2C follow-up: fix DB functions that still reference tenant_id on
-- tables/columns that no longer exist. Each fix is in-place
-- (CREATE OR REPLACE) so the trigger bindings stay attached.

-- 1. sync_lesson_chunks — fires when lessons are inserted/updated/deleted.
--    Used to join courses to grab tenant_id; now there's no tenant.
CREATE OR REPLACE FUNCTION public.sync_lesson_chunks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_course_id uuid;
  v_module_id uuid;
  v_clean_text text;
  v_words text[];
  v_chunk text;
  v_chunk_index integer;
  v_word_count integer;
  v_start integer;
  v_lesson_title text;
  v_course_title text;
  v_module_title text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.lesson_chunks WHERE lesson_id = OLD.id;
    RETURN OLD;
  END IF;

  DELETE FROM public.lesson_chunks WHERE lesson_id = NEW.id;

  IF NEW.content_text IS NULL OR trim(NEW.content_text) = '' THEN
    RETURN NEW;
  END IF;

  SELECT m.course_id, m.id, m.title, c.title
  INTO v_course_id, v_module_id, v_module_title, v_course_title
  FROM public.modules m
  JOIN public.courses c ON c.id = m.course_id
  WHERE m.id = NEW.module_id;

  IF v_course_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_lesson_title := NEW.title;

  v_clean_text := strip_html_tags(NEW.content_text);
  v_clean_text := regexp_replace(v_clean_text, '\s+', ' ', 'g');
  v_clean_text := trim(v_clean_text);

  v_words := string_to_array(v_clean_text, ' ');
  v_word_count := array_length(v_words, 1);

  IF v_word_count IS NULL OR v_word_count = 0 THEN
    RETURN NEW;
  END IF;

  v_chunk_index := 0;
  v_start := 1;

  WHILE v_start <= v_word_count LOOP
    v_chunk := array_to_string(v_words[v_start : LEAST(v_start + 499, v_word_count)], ' ');

    INSERT INTO public.lesson_chunks (
      lesson_id, course_id, module_id,
      chunk_text, chunk_index, source_type, metadata
    ) VALUES (
      NEW.id, v_course_id, v_module_id,
      v_chunk, v_chunk_index, 'summary',
      jsonb_build_object(
        'lesson_title', v_lesson_title,
        'course_title', v_course_title,
        'module_title', v_module_title
      )
    );

    v_chunk_index := v_chunk_index + 1;
    v_start := v_start + 500;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 2. enforce_personality_cooldown skipped — Personality feature unused.

-- 3. audit_role_change — was attached to tenant_memberships (now dropped).
--    Re-attach to user_roles, drop the tenant_id field from the audit row.
CREATE OR REPLACE FUNCTION public.audit_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role) THEN
    INSERT INTO public.auth_audit_log(actor_id, target_user_id, action, before, after)
    VALUES (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      NEW.user_id,
      'role_change',
      jsonb_build_object('role', OLD.role),
      jsonb_build_object('role', NEW.role)
    );
  ELSIF (TG_OP = 'INSERT' AND NEW.role IN ('admin', 'super_admin')) THEN
    INSERT INTO public.auth_audit_log(actor_id, target_user_id, action, before, after)
    VALUES (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      NEW.user_id,
      'role_grant',
      NULL,
      jsonb_build_object('role', NEW.role)
    );
  ELSIF (TG_OP = 'DELETE' AND OLD.role IN ('admin', 'super_admin')) THEN
    INSERT INTO public.auth_audit_log(actor_id, target_user_id, action, before, after)
    VALUES (
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      OLD.user_id,
      'role_revoke',
      jsonb_build_object('role', OLD.role),
      NULL
    );
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$function$;

-- 4. has_role_in_tenant — still referenced tenant_memberships. Drop it.
DROP FUNCTION IF EXISTS public.has_role_in_tenant(uuid, app_role, uuid);
