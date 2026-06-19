-- Phase 2 operations & maintenance alerts
-- Run after operational_alerts.sql

-- Charger back online (uses chargerOffline preference)
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

-- Low wallet balance (mobile users) — fires when usable balance crosses below ₹100
CREATE OR REPLACE FUNCTION ev_trg_wallet_low_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold NUMERIC := 100;
  v_old_usable NUMERIC;
  v_new_usable NUMERIC;
BEGIN
  v_old_usable := COALESCE(OLD.balance_amount, 0) - COALESCE(OLD.hold_amount, 0);
  v_new_usable := COALESCE(NEW.balance_amount, 0) - COALESCE(NEW.hold_amount, 0);

  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  IF v_new_usable < v_threshold AND (TG_OP = 'INSERT' OR v_old_usable >= v_threshold) THEN
    PERFORM ev_notify_user(
      NEW.user_id,
      'Low wallet balance',
      'Your usable balance is ₹' || ROUND(v_new_usable, 2)::text
        || '. Top up at least ₹' || ROUND(v_threshold, 0)::text || ' to continue charging.',
      'wallet_low_balance'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ev_wallet_low_balance ON "EV_WalletAccounts";
CREATE TRIGGER ev_wallet_low_balance
  AFTER INSERT OR UPDATE OF balance_amount, hold_amount, status ON "EV_WalletAccounts"
  FOR EACH ROW
  EXECUTE FUNCTION ev_trg_wallet_low_balance();

-- Firmware OCPP events (sent from gateway via RPC)
CREATE OR REPLACE FUNCTION ev_notify_firmware_alert(
  p_charge_point_id TEXT,
  p_outcome TEXT,
  p_detail TEXT DEFAULT ''
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charger RECORD;
  v_title TEXT;
  v_type TEXT;
  v_message TEXT;
BEGIN
  SELECT id, name, charge_point_id INTO v_charger
  FROM "EV_Chargers"
  WHERE upper(charge_point_id) = upper(trim(p_charge_point_id))
  LIMIT 1;

  IF NOT FOUND THEN
    v_message := upper(trim(p_charge_point_id)) || COALESCE(': ' || NULLIF(trim(p_detail), ''), '');
  ELSE
    v_message := v_charger.name || ' (' || v_charger.charge_point_id || ')'
      || COALESCE(' — ' || NULLIF(trim(p_detail), ''), '');
  END IF;

  IF lower(trim(p_outcome)) IN ('failed', 'fail', 'rejected', 'error') THEN
    v_title := 'Firmware update failed';
    v_type := 'alert';
  ELSIF lower(trim(p_outcome)) IN ('installed', 'complete', 'completed') THEN
    v_title := 'Firmware update installed';
    v_type := 'success';
  ELSE
    v_title := 'Firmware update sent';
    v_type := 'info';
  END IF;

  RETURN ev_notify_admins_if_enabled('firmwareAvailable', v_title, v_message, v_type);
END;
$$;

GRANT EXECUTE ON FUNCTION ev_notify_firmware_alert(TEXT, TEXT, TEXT) TO anon, authenticated;
