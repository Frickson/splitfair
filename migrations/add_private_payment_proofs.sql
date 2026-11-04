
-- SplitFair: optional private payment proof screenshots.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS proof_path text;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_proof_path_format;
ALTER TABLE public.payments ADD CONSTRAINT payments_proof_path_format
 CHECK (
   proof_path IS NULL OR (
     length(proof_path) <= 180
     AND split_part(proof_path, '/', 1) = group_id::text
     AND split_part(proof_path, '/', 2) = created_by::text
     AND split_part(proof_path, '/', 3) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(png|jpg|webp)$'
     AND split_part(proof_path, '/', 4) = ''
   )
 );

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES('splitfair-payment-proofs', 'splitfair-payment-proofs', false, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
 SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "SplitFair group members view payment proofs" ON storage.objects;
CREATE POLICY "SplitFair group members view payment proofs"
 ON storage.objects FOR SELECT TO authenticated
 USING (
  bucket_id='splitfair-payment-proofs'
  AND EXISTS(
   SELECT 1 FROM public.group_members AS gm
   WHERE gm.group_id::text = (storage.foldername(name))[1]
   AND gm.user_id=(SELECT auth.uid())
  )
 );

DROP POLICY IF EXISTS "SplitFair group members upload their own proofs" ON storage.objects;
CREATE POLICY "SplitFair group members upload their own proofs"
 ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (
   bucket_id='splitfair-payment-proofs'
   AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
   AND (storage.foldername(name))[3] IS NULL
   AND lower(storage.extension(name)) IN ('png','jpg','webp')
   AND EXISTS(
    SELECT 1 FROM public.group_members AS gm
    WHERE gm.group_id::text = (storage.foldername(name))[1]
    AND gm.user_id=(SELECT auth.uid())
   )
 );

DROP POLICY IF EXISTS "SplitFair proof uploaders delete their own files" ON storage.objects;
CREATE POLICY "SplitFair proof uploaders delete their own files"
 ON storage.objects FOR DELETE TO authenticated
 USING (
   bucket_id='splitfair-payment-proofs'
   AND owner_id=(SELECT auth.uid())::text
   AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
   AND EXISTS(
    SELECT 1 FROM public.group_members AS gm
    WHERE gm.group_id::text = (storage.foldername(name))[1]
    AND gm.user_id=(SELECT auth.uid())
   )
 );
