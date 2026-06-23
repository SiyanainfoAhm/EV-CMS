-- In-app notifications (run after schema.sql + rls.sql)
-- Web admin bell + mobile; integrates with simulator via ev_notify_* helpers

DROP POLICY IF EXISTS "ev_anon_insert_notifications" ON "EV_Notifications";
CREATE POLICY "ev_anon_insert_notifications" ON "EV_Notifications"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_notifications" ON "EV_Notifications";
CREATE POLICY "ev_anon_update_notifications" ON "EV_Notifications"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION ev_notify_user(
  p_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO "EV_Notifications" (user_id, title, message, type, read)
  VALUES (p_user_id, p_title, p_message, COALESCE(NULLIF(trim(p_type), ''), 'info'), false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_notify_admins(
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id FROM "EV_Users"
    WHERE status = 'active' AND role IN ('SuperAdmin', 'SiteAdmin')
  LOOP
    PERFORM ev_notify_user(r.id, p_title, p_message, p_type);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_notify_user(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_notify_admins(TEXT, TEXT, TEXT) TO anon, authenticated;

-- Demo seed (safe re-run)
INSERT INTO "EV_Notifications" (user_id, title, message, type, read, created_at) VALUES
  ('a0000001-0000-4000-8000-000000000006', 'Charger fault detected', 'MP Fast Charger Station 3 (MP-DC-003) reported Faulted status.', 'alert', false, NOW() - INTERVAL '12 minutes'),
  ('a0000001-0000-4000-8000-000000000006', 'New session started', 'Rajesh Kumar started charging on MP-DC-001 Gun 1.', 'session', false, NOW() - INTERVAL '28 minutes'),
  ('a0000001-0000-4000-8000-000000000006', 'Payment reconciled', 'SBIePay transaction SBI-20260531-001 matched successfully.', 'success', true, NOW() - INTERVAL '2 hours'),
  ('a0000001-0000-4000-8000-000000000006', 'Charger offline', 'MP Slow Charger Bay 3 has not sent a heartbeat for 15+ minutes.', 'warning', true, NOW() - INTERVAL '5 hours'),
  ('a0000001-0000-4000-8000-000000000001', 'Charging started', 'Your session on MP Fast Charger Station 1 has begun.', 'success', false, NOW() - INTERVAL '15 minutes'),
  ('a0000001-0000-4000-8000-000000000001', 'Session reminder', 'Active session is still in progress. Open Live Session to monitor energy.', 'info', true, NOW() - INTERVAL '1 day');

-- Realtime: run supabase/enable_realtime.sql (or Dashboard → Database → Replication)
