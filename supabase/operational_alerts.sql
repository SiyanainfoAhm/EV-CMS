-- Phase 1 operational alerts — preference-aware admin notifications (web bell).
-- Run after notifications.sql and profile_and_storage.sql

-- Default notification prefs (matches EV_UserPreferences default in profile_and_storage.sql)
CREATE OR REPLACE FUNCTION ev_default_notifications()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '{
    "chargerOffline": true,
    "chargerFaulted": true,
    "sessionStarted": false,
    "sessionStopped": false,
    "paymentReceived": true,
    "firmwareAvailable": true,
    "weeklyReport": true,
    "emailDigest": false
  }'::jsonb;
$$;

CREATE OR REPLACE FUNCTION ev_notification_pref_enabled(p_notifications JSONB, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  prefs JSONB;
  val TEXT;
BEGIN
  prefs := COALESCE(p_notifications, ev_default_notifications());
  val := prefs->>p_category;
  IF val IS NULL THEN
    RETURN COALESCE((ev_default_notifications()->>p_category)::boolean, false);
  END IF;
  RETURN val::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION ev_notify_admins_if_enabled(
  p_category TEXT,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
  prefs JSONB;
BEGIN
  FOR r IN
    SELECT u.id, COALESCE(up.notifications, ev_default_notifications()) AS notifications
    FROM "EV_Users" u
    LEFT JOIN "EV_UserPreferences" up ON up.user_id = u.id
    WHERE u.status = 'active'
      AND u.role IN ('SuperAdmin', 'SiteAdmin')
  LOOP
    IF ev_notification_pref_enabled(r.notifications, p_category) THEN
      PERFORM ev_notify_user(r.id, p_title, p_message, COALESCE(NULLIF(trim(p_type), ''), 'info'));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION ev_list_admins_for_notification(p_category TEXT)
RETURNS TABLE(user_id UUID, email TEXT, full_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.full_name
  FROM "EV_Users" u
  LEFT JOIN "EV_UserPreferences" up ON up.user_id = u.id
  WHERE u.status = 'active'
    AND u.role IN ('SuperAdmin', 'SiteAdmin')
    AND ev_notification_pref_enabled(COALESCE(up.notifications, ev_default_notifications()), p_category);
END;
$$;

GRANT EXECUTE ON FUNCTION ev_notify_admins_if_enabled(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_list_admins_for_notification(TEXT) TO anon, authenticated;

-- Charger status: offline / faulted
CREATE OR REPLACE FUNCTION ev_trg_charger_status_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'offline' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'offline') THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerOffline',
      'Charger offline',
      NEW.name || ' (' || NEW.charge_point_id || ') has lost connectivity.',
      'warning'
    );
  ELSIF NEW.status = 'faulted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'faulted') THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerFaulted',
      'Charger fault detected',
      NEW.name || ' (' || NEW.charge_point_id || ') reported a fault condition.',
      'alert'
    );
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'online'
    AND OLD.status = 'offline' THEN
    PERFORM ev_notify_admins_if_enabled(
      'chargerOffline',
      'Charger back online',
      NEW.name || ' (' || NEW.charge_point_id || ') has reconnected and is online.',
      'success'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_charger_status_alert ON "EV_Chargers";
CREATE TRIGGER ev_charger_status_alert
  AFTER INSERT OR UPDATE OF status ON "EV_Chargers"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_charger_status_alert();

-- Session started / stopped
CREATE OR REPLACE FUNCTION ev_trg_session_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_charger_name TEXT;
  v_charge_point_id TEXT;
BEGIN
  SELECT c.name, c.charge_point_id INTO v_charger_name, v_charge_point_id
  FROM "EV_Chargers" c
  WHERE c.id = NEW.charger_id;

  SELECT u.full_name INTO v_user_name
  FROM "EV_Users" u
  WHERE u.id = NEW.user_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    PERFORM ev_notify_admins_if_enabled(
      'sessionStarted',
      'New session started',
      COALESCE(v_user_name, 'A user') || ' started charging on '
        || COALESCE(v_charger_name, 'charger') || ' (connector ' || NEW.connector_id::text || ').',
      'session'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'completed' THEN
    PERFORM ev_notify_admins_if_enabled(
      'sessionStopped',
      'Session stopped',
      'Charging session ended on ' || COALESCE(v_charger_name, 'charger')
        || ' (' || COALESCE(v_charge_point_id, '') || ') for ' || COALESCE(v_user_name, 'user') || '.',
      'info'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_session_alert ON "EV_ChargingSessions";
CREATE TRIGGER ev_session_alert
  AFTER INSERT OR UPDATE OF status ON "EV_ChargingSessions"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_session_alert();

-- Payment success / failure
CREATE OR REPLACE FUNCTION ev_trg_payment_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_amount TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT u.full_name INTO v_user_name FROM "EV_Users" u WHERE u.id = NEW.user_id;
  v_amount := '₹' || COALESCE(NEW.total_amount, 0)::text;

  IF NEW.status = 'success' THEN
    PERFORM ev_notify_admins_if_enabled(
      'paymentReceived',
      'Payment received',
      COALESCE(v_user_name, 'User') || ' — ' || v_amount
        || COALESCE(' (Txn: ' || NULLIF(NEW.gateway_txn_id, '') || ')', ''),
      'success'
    );
  ELSIF NEW.status = 'failed' THEN
    PERFORM ev_notify_admins_if_enabled(
      'paymentReceived',
      'Payment failed',
      COALESCE(v_user_name, 'User') || ' — payment failed for ' || v_amount || '.',
      'alert'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_payment_alert ON "EV_Payments";
CREATE TRIGGER ev_payment_alert
  AFTER UPDATE OF status ON "EV_Payments"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_payment_alert();

-- Simulator: stop duplicate admin alerts (DB triggers handle web admins)
CREATE OR REPLACE FUNCTION ev_sim_set_charger_status(p_charger_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_db_status TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_db_status := CASE lower(trim(p_status))
    WHEN 'available' THEN 'online'
    WHEN 'charging' THEN 'online'
    WHEN 'preparing' THEN 'online'
    WHEN 'finishing' THEN 'online'
    WHEN 'faulted' THEN 'faulted'
    WHEN 'unavailable' THEN 'offline'
    WHEN 'offline' THEN 'offline'
    ELSE 'online'
  END;

  UPDATE "EV_Chargers"
  SET status = v_db_status, last_status_change_at = v_now, updated_at = v_now,
      last_heartbeat_at = CASE WHEN lower(trim(p_status)) = 'offline' THEN v_now - INTERVAL '20 minutes' ELSE NOW() END
  WHERE id = p_charger_id;

  UPDATE "EV_ChargerConnectors"
  SET status = p_status, updated_at = v_now
  WHERE charger_id = p_charger_id AND connector_id = 1;

  PERFORM ev_sim_log_event(p_charger_id, 1, 'StatusNotification', jsonb_build_object('status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_start_session(
  p_charger_id UUID,
  p_connector_id INTEGER,
  p_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_tariff_id UUID;
  v_rfid_id UUID;
  v_txn INTEGER;
BEGIN
  SELECT id INTO v_tariff_id FROM "EV_Tariffs" WHERE is_active = true ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO v_rfid_id FROM "EV_RFIDCards" WHERE user_id = p_user_id AND status = 'active' LIMIT 1;

  v_txn := (EXTRACT(EPOCH FROM NOW())::INTEGER % 2000000000);

  INSERT INTO "EV_ChargingSessions" (
    transaction_id, charger_id, connector_id, user_id, rfid_card_id, tariff_id,
    start_time, energy_kwh, current_power_kw, status, authorization_method
  ) VALUES (
    v_txn, p_charger_id, p_connector_id, p_user_id, v_rfid_id, v_tariff_id,
    NOW(), 0, 0, 'active', 'RFID'
  )
  RETURNING id INTO v_session_id;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Charging', updated_at = NOW()
  WHERE charger_id = p_charger_id AND connector_id = p_connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = p_charger_id;

  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'Authorize', jsonb_build_object('userId', p_user_id));
  PERFORM ev_sim_log_event(p_charger_id, p_connector_id, 'StartTransaction', jsonb_build_object('sessionId', v_session_id));

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'Remote Start', 'Session', v_session_id::text, 'Simulator StartTransaction');

  PERFORM ev_notify_user(p_user_id, 'Charging started', 'Your session has begun on connector ' || p_connector_id::text, 'charging_started');

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = v_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = p_user_id AND type = 'charging_started'
    ORDER BY created_at DESC
    LIMIT 1
  );

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION ev_sim_stop_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_rate NUMERIC := 15;
  v_fee NUMERIC := 20;
  v_amount NUMERIC;
  v_gst NUMERIC;
  v_total NUMERIC;
BEGIN
  SELECT s.*, t.rate_per_kwh, t.session_fee
  INTO v_sess
  FROM "EV_ChargingSessions" s
  LEFT JOIN "EV_Tariffs" t ON t.id = s.tariff_id
  WHERE s.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  v_rate := COALESCE(v_sess.rate_per_kwh, 15);
  v_fee := COALESCE(v_sess.session_fee, 20);
  v_amount := ROUND(COALESCE(v_sess.energy_kwh, 0) * v_rate + v_fee, 2);
  v_gst := ROUND(v_amount * 0.18, 2);
  v_total := v_amount + v_gst;

  UPDATE "EV_ChargingSessions"
  SET status = 'completed', end_time = NOW(), amount = v_amount,
      current_power_kw = 0, stop_reason = 'Local', updated_at = NOW()
  WHERE id = p_session_id;

  UPDATE "EV_ChargerConnectors"
  SET status = 'Available', updated_at = NOW()
  WHERE charger_id = v_sess.charger_id AND connector_id = v_sess.connector_id;

  UPDATE "EV_Chargers"
  SET status = 'online', last_status_change_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
  WHERE id = v_sess.charger_id;

  INSERT INTO "EV_Payments" (session_id, user_id, amount, gst_amount, total_amount, status, gateway, reconciliation_status)
  VALUES (p_session_id, v_sess.user_id, v_amount, v_gst, v_total, 'pending', 'wallet', 'unmatched');

  PERFORM ev_sim_log_event(v_sess.charger_id, v_sess.connector_id, 'StopTransaction', jsonb_build_object('sessionId', p_session_id, 'amount', v_total));

  INSERT INTO "EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (v_sess.user_id, 'Remote Stop', 'Session', p_session_id::text, 'Simulator StopTransaction');

  PERFORM ev_notify_user(
    v_sess.user_id,
    'Charging completed',
    'Session finished. Pay ₹' || ROUND(v_total, 2)::text || ' from your wallet.',
    'charging_stopped'
  );

  UPDATE "EV_Notifications" n
  SET reference_type = 'charging_session', reference_id = p_session_id
  WHERE n.id = (
    SELECT id FROM "EV_Notifications"
    WHERE user_id = v_sess.user_id AND type = 'charging_stopped'
    ORDER BY created_at DESC
    LIMIT 1
  );
END;
$$;
