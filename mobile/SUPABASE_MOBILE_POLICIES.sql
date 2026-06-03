-- Run in Supabase SQL Editor after schema.sql + rls.sql + policies_write.sql
-- Enables mobile app writes (start/stop sessions, support tickets) via anon key (demo only).

CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Mobile avatar uploads (ev-media bucket). If you already ran supabase/profile_and_storage.sql,
-- these policies likely exist. Running again is safe if you add IF NOT EXISTS manually.
CREATE POLICY "ev_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'ev-media');

CREATE POLICY "ev_media_anon_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'ev-media' AND (storage.foldername(name))[1] = 'EV');

CREATE POLICY "ev_media_anon_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'ev-media')
  WITH CHECK (bucket_id = 'ev-media');

CREATE POLICY "ev_media_anon_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'ev-media');
