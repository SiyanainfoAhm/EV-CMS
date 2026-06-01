-- Run after policies_write.sql — profile fields, preferences, media path support.
-- Demo: anon can update own profile via SECURITY DEFINER RPCs.

ALTER TABLE "EV_Users"
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS employee_id TEXT;

CREATE TABLE IF NOT EXISTS "EV_UserPreferences" (
  user_id UUID PRIMARY KEY REFERENCES "EV_Users"(id) ON DELETE CASCADE,
  notifications JSONB NOT NULL DEFAULT '{
    "chargerOffline": true,
    "chargerFaulted": true,
    "sessionStarted": false,
    "sessionStopped": false,
    "paymentReceived": true,
    "firmwareAvailable": true,
    "weeklyReport": true,
    "emailDigest": false
  }'::jsonb,
  system_settings JSONB NOT NULL DEFAULT '{
    "sessionTimeout": 30,
    "autoRefreshInterval": 15,
    "dateFormat": "DD/MM/YYYY",
    "timeFormat": "24h",
    "energyUnit": "kWh",
    "currency": "INR"
  }'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "EV_UserPreferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ev_anon_select_preferences" ON "EV_UserPreferences"
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ev_anon_upsert_preferences" ON "EV_UserPreferences"
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Backfill employee IDs for existing users
UPDATE "EV_Users" u
SET employee_id = sub.emp_id
FROM (
  SELECT
    id,
    'DFCCIL-' || upper(left(COALESCE(department, 'OPS'), 3)) || '-' ||
    lpad((row_number() OVER (PARTITION BY COALESCE(department, 'OPS') ORDER BY created_at))::text, 3, '0') AS emp_id
  FROM "EV_Users"
) sub
WHERE u.id = sub.id AND u.employee_id IS NULL;

-- Extend login RPC return shape
DROP FUNCTION IF EXISTS verify_ev_login(TEXT, TEXT);

CREATE OR REPLACE FUNCTION verify_ev_login(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user "EV_Users"%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM "EV_Users" u
  WHERE lower(u.email) = lower(trim(p_email));

  IF NOT FOUND THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'login_failed', 'auth', lower(trim(p_email)), 'Unknown email');
    RETURN;
  END IF;

  IF v_user.status <> 'active' THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Account is not active');
    RETURN;
  END IF;

  IF v_user.password_hash <> ev_password_hash(p_password, v_user.salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (v_user.id, 'login_failed', 'auth', v_user.id::text, 'Invalid password');
    RETURN;
  END IF;

  UPDATE "EV_Users" u
  SET last_login_at = NOW(), updated_at = NOW()
  WHERE u.id = v_user.id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_user.id, 'login', 'auth', v_user.id::text, 'Successful login');

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.email,
    v_user.full_name,
    v_user.role,
    v_user.department,
    v_user.status,
    v_user.phone,
    v_user.avatar_url,
    v_user.employee_id,
    NOW(),
    v_user.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_ev_login(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS list_ev_users();

CREATE OR REPLACE FUNCTION list_ev_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  rfid_uid TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.department,
    u.status,
    u.phone,
    u.avatar_url,
    u.employee_id,
    u.last_login_at,
    u.created_at,
    r.uid AS rfid_uid
  FROM "EV_Users" u
  LEFT JOIN LATERAL (
    SELECT uid FROM "EV_RFIDCards" rf
    WHERE rf.user_id = u.id AND rf.status = 'active'
    ORDER BY rf.created_at DESC
    LIMIT 1
  ) r ON true
  ORDER BY u.full_name;
$$;

GRANT EXECUTE ON FUNCTION list_ev_users() TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_ev_user_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT,
  department TEXT,
  status TEXT,
  phone TEXT,
  avatar_url TEXT,
  employee_id TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  notifications JSONB,
  system_settings JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "EV_UserPreferences" (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.role,
    u.department,
    u.status,
    u.phone,
    u.avatar_url,
    u.employee_id,
    u.last_login_at,
    u.created_at,
    p.notifications,
    p.system_settings
  FROM "EV_Users" u
  LEFT JOIN "EV_UserPreferences" p ON p.user_id = u.id
  WHERE u.id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ev_user_profile(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION update_ev_user_profile(
  p_user_id UUID,
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE "EV_Users"
  SET
    full_name = trim(p_full_name),
    email = lower(trim(p_email)),
    phone = NULLIF(trim(p_phone), ''),
    department = COALESCE(NULLIF(trim(p_department), ''), department),
    avatar_url = COALESCE(p_avatar_url, avatar_url),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'update', 'user_profile', p_user_id::text, 'Profile updated');
END;
$$;

GRANT EXECUTE ON FUNCTION update_ev_user_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION upsert_ev_user_preferences(
  p_user_id UUID,
  p_notifications JSONB,
  p_system_settings JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO "EV_UserPreferences" (user_id, notifications, system_settings, updated_at)
  VALUES (p_user_id, p_notifications, p_system_settings, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    notifications = EXCLUDED.notifications,
    system_settings = EXCLUDED.system_settings,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_ev_user_preferences(UUID, JSONB, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION change_ev_user_password(
  p_user_id UUID,
  p_current_password TEXT,
  p_new_password TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  SELECT salt, password_hash INTO v_salt, v_hash
  FROM "EV_Users"
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_hash <> ev_password_hash(p_current_password, v_salt) THEN
    INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
    VALUES (p_user_id, 'login_failed', 'auth', p_user_id::text, 'Password change — wrong current password');
    RETURN false;
  END IF;

  UPDATE "EV_Users"
  SET
    password_hash = ev_password_hash(p_new_password, v_salt),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'update', 'auth', p_user_id::text, 'Password changed');

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION change_ev_user_password(UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_ev_login_history(p_user_id UUID, p_limit INT DEFAULT 20)
RETURNS TABLE (
  id UUID,
  action TEXT,
  details TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, action, details, ip_address, created_at
  FROM "EV_AuditLogs"
  WHERE user_id = p_user_id
    AND entity_type = 'auth'
    AND action IN ('login', 'login_failed')
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_ev_login_history(UUID, INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_ev_login_attempt(
  p_email TEXT,
  p_success BOOLEAN,
  p_details TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_action TEXT;
BEGIN
  v_action := CASE WHEN p_success THEN 'login' ELSE 'login_failed' END;

  SELECT id INTO v_user_id
  FROM "EV_Users"
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    v_action,
    'auth',
    COALESCE(v_user_id::text, lower(trim(p_email))),
    COALESCE(p_details, CASE WHEN p_success THEN 'Successful login' ELSE 'Failed login attempt' END)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ev_login_attempt(TEXT, BOOLEAN, TEXT) TO anon, authenticated;

-- Supabase Storage: bucket ev-media, paths EV/{user_id}/...
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ev-media',
  'ev-media',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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

-- Sample OCPP events for charger detail (first DC charger)
INSERT INTO "EV_ChargerEvents" (charger_id, connector_id, event_type, payload, created_at)
SELECT
  'b0000001-0000-4000-8000-000000000001'::uuid,
  v.connector_id,
  v.event_type,
  v.payload::jsonb,
  v.created_at
FROM (VALUES
  (NULL::int, 'BootNotification', '{"chargePointModel":"MP-30DC-DG","chargePointVendor":"MyPower"}', NOW() - INTERVAL '2 hours'),
  (NULL::int, 'BootNotification.conf', '{"status":"Accepted","interval":300}', NOW() - INTERVAL '2 hours' + INTERVAL '1 second'),
  (1, 'StatusNotification', '{"connectorId":1,"status":"Available","errorCode":"NoError"}', NOW() - INTERVAL '90 minutes'),
  (1, 'Heartbeat', '{}', NOW() - INTERVAL '30 minutes'),
  (1, 'Heartbeat.conf', '{"currentTime":"2026-06-01T10:35:16Z"}', NOW() - INTERVAL '30 minutes' + INTERVAL '1 second'),
  (1, 'Authorize', '{"idTag":"RFID-DFCCIL-001"}', NOW() - INTERVAL '20 minutes'),
  (1, 'StartTransaction', '{"connectorId":1,"meterStart":12500}', NOW() - INTERVAL '18 minutes'),
  (1, 'MeterValues', '{"connectorId":1,"transactionId":1001,"meterValue":[{"sampledValue":[{"value":"12780.5"}]}]}', NOW() - INTERVAL '10 minutes')
) AS v(connector_id, event_type, payload, created_at)
WHERE EXISTS (SELECT 1 FROM "EV_Chargers" WHERE id = 'b0000001-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM "EV_ChargerEvents" WHERE charger_id = 'b0000001-0000-4000-8000-000000000001' LIMIT 1);
