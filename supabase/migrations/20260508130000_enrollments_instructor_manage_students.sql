-- Allow tenant instructors to manage course enrollments — but ONLY for users
-- whose tenant role is 'student' in the same tenant. Existing admin policies
-- remain unchanged; this is purely additive.

DROP POLICY IF EXISTS "Instructors can manage student enrollments in their tenant"
  ON public.enrollments;

CREATE POLICY "Instructors can manage student enrollments in their tenant"
  ON public.enrollments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships instr
      WHERE instr.user_id = auth.uid()
        AND instr.tenant_id = enrollments.tenant_id
        AND instr.role = 'instructor'
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships target
      WHERE target.user_id = enrollments.user_id
        AND target.tenant_id = enrollments.tenant_id
        AND target.role = 'student'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships instr
      WHERE instr.user_id = auth.uid()
        AND instr.tenant_id = enrollments.tenant_id
        AND instr.role = 'instructor'
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships target
      WHERE target.user_id = enrollments.user_id
        AND target.tenant_id = enrollments.tenant_id
        AND target.role = 'student'
    )
  );
