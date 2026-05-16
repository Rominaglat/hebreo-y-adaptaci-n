-- Allow tenant instructors to read all personality assessments in their tenant
-- (so they can view the admin "תוצאות שאלוני אישיות" page).
-- Instructors do NOT get insert/update/delete access.

DROP POLICY IF EXISTS "personality_tenant_admins_select_all" ON public.personality_assessments;
DROP POLICY IF EXISTS "personality_tenant_staff_select_all" ON public.personality_assessments;

CREATE POLICY "personality_tenant_staff_select_all"
  ON public.personality_assessments FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = personality_assessments.tenant_id
        AND tm.role IN ('admin', 'super_admin', 'instructor')
    )
  );
