-- EV CMS custom push + in-app notifications (extends existing EV_ tables).
-- Uses EV_Users.id (custom auth — not auth.users).
-- Run in Supabase SQL Editor after schema.sql + mobile policies.

-- ---------------------------------------------------------------------------
-- Extend EV_UserPushTokens (already created in SUPABASE_MOBILE_POLICIES.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'expo';
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS device_id TEXT NULL;
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS device_name TEXT NULL;
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EV_UserPushTokens" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- Extend EV_Notifications (message = body, read = is_read in mobile app)
-- ---------------------------------------------------------------------------
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS reference_type TEXT NULL;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS reference_id UUID NULL;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS push_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EV_Notifications" ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN "EV_Notifications"."message" IS 'Notification body text (shown as body in mobile UI)';
COMMENT ON COLUMN "EV_Notifications"."read" IS 'Read flag (is_read in mobile UI)';

-- Allowed notification types (enforced in backend; mobile displays any type):
-- charging_started, charging_stopped, payment_success, payment_failed,
-- wallet_low_balance, support_ticket_updated, charger_fault, charger_offline, general
-- Legacy types from seed: info, alert, warning, success, session

ALTER TABLE "EV_UserPushTokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EV_Notifications" ENABLE ROW LEVEL SECURITY;

-- Push tokens: mobile manages own rows (demo uses anon + app filters by user_id)
DROP POLICY IF EXISTS "ev_push_tokens_select" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_select" ON "EV_UserPushTokens"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_push_tokens_insert" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_insert" ON "EV_UserPushTokens"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_push_tokens_update" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_update" ON "EV_UserPushTokens"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_push_tokens_delete" ON "EV_UserPushTokens";
CREATE POLICY "ev_push_tokens_delete" ON "EV_UserPushTokens"
  FOR DELETE TO anon, authenticated USING (true);

-- Notifications: users read/update own rows; system inserts via ev_notify_user (SECURITY DEFINER)
DROP POLICY IF EXISTS "ev_notifications_select" ON "EV_Notifications";
CREATE POLICY "ev_notifications_select" ON "EV_Notifications"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_notifications_update_read" ON "EV_Notifications";
CREATE POLICY "ev_notifications_update_read" ON "EV_Notifications"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Mobile must NOT insert system notifications (charging/payment/etc.) — use backend RPC only.
DROP POLICY IF EXISTS "ev_anon_insert_notifications" ON "EV_Notifications";

-- Realtime: enable EV_Notifications in Dashboard → Database → Replication
