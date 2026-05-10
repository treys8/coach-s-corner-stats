-- School logo storage bucket.
--
-- Files are stored under /{school_id}/{filename}. The bucket is public-read so
-- the resulting URL can be used directly in <img src>. Writes are restricted
-- to school admins of the school whose UUID matches the first path segment.

INSERT INTO storage.buckets (id, name, public)
VALUES ('school-logos', 'school-logos', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "school-logos public read"   ON storage.objects;
DROP POLICY IF EXISTS "school-logos admin insert"  ON storage.objects;
DROP POLICY IF EXISTS "school-logos admin update"  ON storage.objects;
DROP POLICY IF EXISTS "school-logos admin delete"  ON storage.objects;

CREATE POLICY "school-logos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'school-logos');

CREATE POLICY "school-logos admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'school-logos'
    AND EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id::TEXT = (storage.foldername(name))[1]
        AND public.is_school_admin(s.id)
    )
  );

CREATE POLICY "school-logos admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'school-logos'
    AND EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id::TEXT = (storage.foldername(name))[1]
        AND public.is_school_admin(s.id)
    )
  )
  WITH CHECK (
    bucket_id = 'school-logos'
    AND EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id::TEXT = (storage.foldername(name))[1]
        AND public.is_school_admin(s.id)
    )
  );

CREATE POLICY "school-logos admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'school-logos'
    AND EXISTS (
      SELECT 1 FROM public.schools s
      WHERE s.id::TEXT = (storage.foldername(name))[1]
        AND public.is_school_admin(s.id)
    )
  );
