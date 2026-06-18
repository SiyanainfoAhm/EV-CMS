-- Run in Supabase SQL Editor after schema.sql + rls.sql + policies_write.sql
-- Enables mobile app writes (start/stop sessions, support tickets, push tokens) via anon key (demo only).
-- Canonical copy also lives at supabase/mobile_policies.sql

DROP POLICY IF EXISTS "ev_anon_insert_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_insert_sessions" ON "EV_ChargingSessions"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_sessions" ON "EV_ChargingSessions";
CREATE POLICY "ev_anon_update_sessions" ON "EV_ChargingSessions"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_insert_support" ON "EV_SupportTickets";
CREATE POLICY "ev_anon_insert_support" ON "EV_SupportTickets"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "EV_UserPushTokens" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_ev_push_tokens_user ON "EV_UserPushTokens" (user_id);

ALTER TABLE "EV_UserPushTokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_anon_manage_push_tokens" ON "EV_UserPushTokens";
CREATE POLICY "ev_anon_manage_push_tokens" ON "EV_UserPushTokens"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "EV_UserPushTokens" TO anon, authenticated;

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

UPDATE "EV_Chargers" SET latitude = 28.6145, longitude = 77.2085 WHERE charge_point_id = 'MP-DC-001';
UPDATE "EV_Chargers" SET latitude = 28.6148, longitude = 77.2092 WHERE charge_point_id = 'MP-DC-002';
UPDATE "EV_Chargers" SET latitude = 19.0765, longitude = 72.8785 WHERE charge_point_id = 'MP-DC-003';
UPDATE "EV_Chargers" SET latitude = 19.0770, longitude = 72.8790 WHERE charge_point_id = 'MP-DC-004';
UPDATE "EV_Chargers" SET latitude = 28.6120, longitude = 77.2050 WHERE charge_point_id = 'MP-AC-001';
UPDATE "EV_Chargers" SET latitude = 28.6125, longitude = 77.2055 WHERE charge_point_id = 'MP-AC-002';
UPDATE "EV_Chargers" SET latitude = 28.6130, longitude = 77.2060 WHERE charge_point_id = 'MP-AC-003';
UPDATE "EV_Chargers" SET latitude = 13.0830, longitude = 80.2710 WHERE charge_point_id = 'MP-AC-004';
UPDATE "EV_Chargers" SET latitude = 13.0835, longitude = 80.2715 WHERE charge_point_id = 'MP-AC-005';
UPDATE "EV_Chargers" SET latitude = 13.0840, longitude = 80.2720 WHERE charge_point_id = 'MP-AC-006';
UPDATE "EV_Chargers" SET latitude = 22.5730, longitude = 88.3640 WHERE charge_point_id = 'TS-DC-001';
UPDATE "EV_Chargers" SET latitude = 22.5735, longitude = 88.3645 WHERE charge_point_id = 'TS-AC-001';
