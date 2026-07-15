-- Weekly study goals (in-app gamification). One active goal per student.
-- RLS: a student fully owns their own goal row; service_role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.student_goals (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unit              text        NOT NULL CHECK (unit IN ('hours','lessons')),
  target            numeric     NOT NULL CHECK (target > 0),
  emails_enabled    boolean     NOT NULL DEFAULT true,
  unsubscribe_token uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_student_goals_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_student_goals_touch ON public.student_goals;
CREATE TRIGGER trg_student_goals_touch
  BEFORE UPDATE ON public.student_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_student_goals_updated_at();

ALTER TABLE public.student_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_goals_select_own ON public.student_goals;
CREATE POLICY student_goals_select_own ON public.student_goals
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS student_goals_insert_own ON public.student_goals;
CREATE POLICY student_goals_insert_own ON public.student_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS student_goals_update_own ON public.student_goals;
CREATE POLICY student_goals_update_own ON public.student_goals
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS student_goals_delete_own ON public.student_goals;
CREATE POLICY student_goals_delete_own ON public.student_goals
  FOR DELETE USING (auth.uid() = user_id);

-- admin-configurable default lesson length (used to convert lessons <-> hours).
-- tenant_settings is the existing single-row settings table used by PlatformSettings.
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS default_lesson_minutes int NOT NULL DEFAULT 30;
