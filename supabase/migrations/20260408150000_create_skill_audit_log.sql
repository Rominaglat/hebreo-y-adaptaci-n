-- Skill audit log: tracks all admin actions and submissions for the Skills Library.

CREATE TABLE IF NOT EXISTS skill_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  skill_id UUID REFERENCES skills(id) ON DELETE SET NULL,
  version_id UUID REFERENCES skill_versions(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_audit_log_skill ON skill_audit_log(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_audit_log_actor ON skill_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_skill_audit_log_created ON skill_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_audit_log_action ON skill_audit_log(action);

ALTER TABLE skill_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit log; service role inserts via edge functions
DROP POLICY IF EXISTS "Admins can view audit log" ON skill_audit_log;
CREATE POLICY "Admins can view audit log"
  ON skill_audit_log FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM tenant_memberships
      WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );
