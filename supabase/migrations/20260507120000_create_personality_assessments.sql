-- Personality Assessments: E-Myth (Entrepreneur/Manager/Artisan) + DISC (R/Y/G/B) + AI insights.
-- Hebrew-only, gender-neutral phrasing. Per-user history. 7-day cooldown enforced via trigger.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.personality_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version smallint NOT NULL DEFAULT 1,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  emyth_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  disc_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  disc_primary text CHECK (disc_primary IN ('R','Y','G','B')),
  disc_secondary text CHECK (disc_secondary IN ('R','Y','G','B')),
  insights jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_ai_response jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personality_assessments_user_tenant_idx
  ON public.personality_assessments (user_id, tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS personality_assessments_tenant_idx
  ON public.personality_assessments (tenant_id, created_at DESC);

-- 7-day cooldown trigger. Edge function checks first for friendly error;
-- this is the defense-in-depth backstop against direct DB writes.
CREATE OR REPLACE FUNCTION public.enforce_personality_cooldown()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.personality_assessments
    WHERE user_id = NEW.user_id
      AND tenant_id = NEW.tenant_id
      AND created_at > now() - interval '7 days'
  ) THEN
    RAISE EXCEPTION 'personality_cooldown_active' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personality_cooldown_trg ON public.personality_assessments;
CREATE TRIGGER personality_cooldown_trg
  BEFORE INSERT ON public.personality_assessments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_personality_cooldown();

ALTER TABLE public.personality_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personality_users_select_own" ON public.personality_assessments;
CREATE POLICY "personality_users_select_own"
  ON public.personality_assessments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "personality_users_insert_own" ON public.personality_assessments;
CREATE POLICY "personality_users_insert_own"
  ON public.personality_assessments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Tenant admins/super_admins see ALL assessments in their tenant (for the admin view).
DROP POLICY IF EXISTS "personality_tenant_admins_select_all" ON public.personality_assessments;
CREATE POLICY "personality_tenant_admins_select_all"
  ON public.personality_assessments FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = personality_assessments.tenant_id
        AND tm.role IN ('admin', 'super_admin')
    )
  );

-- Append-only: no UPDATE/DELETE policies. Service role bypasses RLS for any cleanup.

COMMENT ON TABLE public.personality_assessments IS
  'E-Myth + DISC personality questionnaire results, Hebrew. Append-only history, 7-day cooldown.';
