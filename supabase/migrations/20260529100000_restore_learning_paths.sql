-- Restore the learning_paths table for the single-tenant LMS. The
-- original AI Agency School migration was dropped (it was bundled with
-- the unused Skills Library schema), but the Learning Paths feature is
-- still wired up in the frontend (useLearningPath hook) and edge
-- function (generate-learning-path). One row per user — replace-on-save.

CREATE TABLE IF NOT EXISTS public.learning_paths (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal          TEXT NOT NULL,
  steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_step  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS learning_paths_user_idx
  ON public.learning_paths (user_id);

DROP TRIGGER IF EXISTS learning_paths_set_updated_at ON public.learning_paths;
CREATE TRIGGER learning_paths_set_updated_at
  BEFORE UPDATE ON public.learning_paths
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learning_paths_owner_select ON public.learning_paths;
CREATE POLICY learning_paths_owner_select ON public.learning_paths
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS learning_paths_owner_modify ON public.learning_paths;
CREATE POLICY learning_paths_owner_modify ON public.learning_paths
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admins/instructors can read everyone's paths for support.
DROP POLICY IF EXISTS learning_paths_staff_read ON public.learning_paths;
CREATE POLICY learning_paths_staff_read ON public.learning_paths
  FOR SELECT
  USING (is_admin_or_instructor(auth.uid()) OR is_super_admin(auth.uid()));
