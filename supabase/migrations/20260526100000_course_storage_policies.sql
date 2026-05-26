-- Storage RLS policies for the public buckets used by the LMS.
-- `course-images` and `course-content` are marked public (anyone can read via
-- the public URL), but writes must be gated to authenticated users.

-- ── course-images: lesson files, course thumbnails, resources, transcripts ──
DROP POLICY IF EXISTS "course_images_public_read" ON storage.objects;
CREATE POLICY "course_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'course-images');

DROP POLICY IF EXISTS "course_images_auth_insert" ON storage.objects;
CREATE POLICY "course_images_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'course-images' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "course_images_auth_update" ON storage.objects;
CREATE POLICY "course_images_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'course-images' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "course_images_auth_delete" ON storage.objects;
CREATE POLICY "course_images_auth_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'course-images'
    AND auth.uid() IS NOT NULL
    AND (is_admin_or_instructor(auth.uid()) OR owner = auth.uid())
  );

-- ── course-content: rich-text editor embedded images and media ──
DROP POLICY IF EXISTS "course_content_public_read" ON storage.objects;
CREATE POLICY "course_content_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'course-content');

DROP POLICY IF EXISTS "course_content_auth_insert" ON storage.objects;
CREATE POLICY "course_content_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'course-content' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "course_content_auth_update" ON storage.objects;
CREATE POLICY "course_content_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'course-content' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "course_content_auth_delete" ON storage.objects;
CREATE POLICY "course_content_auth_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'course-content'
    AND auth.uid() IS NOT NULL
    AND (is_admin_or_instructor(auth.uid()) OR owner = auth.uid())
  );
