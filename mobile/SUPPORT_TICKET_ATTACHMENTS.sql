-- Support ticket attachments in ev-media bucket.
-- Path: support-tickets/{user_id}/{ticket_id}/{filename}
-- Run in Supabase SQL Editor after schema.sql + mobile policies.

ALTER TABLE "EV_SupportTickets"
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "EV_SupportTickets"."attachments" IS
  'Array of {name, path, url, mimeType, size, uploadedAt} for files in ev-media/support-tickets/{user_id}/{ticket_id}/';

-- Allow images + PDF for ticket attachments (bucket may already exist).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ev-media',
  'ev-media',
  true,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "ev_media_anon_upload" ON storage.objects;
CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (
        (storage.foldername(name))[1] = 'support-tickets'
        AND (storage.foldername(name))[2] IS NOT NULL
        AND (storage.foldername(name))[3] IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ev_media_anon_update" ON storage.objects;
CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (storage.foldername(name))[1] = 'support-tickets'
    )
  )
  WITH CHECK (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (
        (storage.foldername(name))[1] = 'support-tickets'
        AND (storage.foldername(name))[2] IS NOT NULL
        AND (storage.foldername(name))[3] IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "ev_media_anon_delete" ON storage.objects;
CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (
    bucket_id = 'ev-media'
    AND (
      (storage.foldername(name))[1] = 'EV'
      OR (storage.foldername(name))[1] = 'support-tickets'
    )
  );
