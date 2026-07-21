-- Mobile-only charger online gate for start charging / prepaid payment.
-- Does NOT change admin web RemoteStart / OCPP flows.
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION ev_mobile_assert_charger_online(p_charger_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT lower(trim(COALESCE(status, '')))
  INTO v_status
  FROM "EV_Chargers"
  WHERE id = p_charger_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHARGER_NOT_FOUND';
  END IF;

  IF v_status IS NULL OR v_status = '' OR v_status NOT IN ('online', 'available') THEN
    RAISE EXCEPTION 'Charger is not online. Please select another charger.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_mobile_assert_charger_online(UUID) TO anon, authenticated;

COMMENT ON FUNCTION ev_mobile_assert_charger_online(UUID) IS
  'Mobile app only: reject session/payment start unless EV_Chargers.status is online or available.';
