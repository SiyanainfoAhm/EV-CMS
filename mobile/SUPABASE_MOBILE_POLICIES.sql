-- Run in Supabase SQL Editor after schema.sql + rls.sql + policies_write.sql
-- Enables mobile app writes (start/stop sessions, support tickets) via anon key (demo only).

DROP POLICY IF EXISTS "ev_anon_insert_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_support" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Mobile avatar uploads (ev-media bucket). If you already ran supabase/profile_and_storage.sql,
-- these policies likely exist.
DROP POLICY IF EXISTS "ev_media_public_read" ON storage.objects;
CREATE POLICY "ev_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'ev-media');

DROP POLICY IF EXISTS "ev_media_anon_upload" ON storage.objects;
CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'ev-media' AND (storage.foldername(name))[1] = 'EV');

DROP POLICY IF EXISTS "ev_media_anon_update" ON storage.objects;
CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'ev-media')
  WITH CHECK (bucket_id = 'ev-media');

DROP POLICY IF EXISTS "ev_media_anon_delete" ON storage.objects;
CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'ev-media');
