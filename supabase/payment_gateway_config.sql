-- Dynamic payment gateway config (Razorpay test / HDFC production).
-- Safe to re-run. Does not delete existing EV_SystemConfig rows.
-- Default: testing_mode = true → Razorpay (current testing continues).

-- ---------------------------------------------------------------------------
-- 1) System config table (compatible with existing key/value schema)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."EV_SystemConfig" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public."EV_SystemConfig"
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public."EV_SystemConfig" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ev_get_system_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT value FROM public."EV_SystemConfig"
  WHERE key = p_key AND COALESCE(is_active, true) = true
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 2) payment_gateway config row (default testing_mode = true → Razorpay)
-- ---------------------------------------------------------------------------
INSERT INTO public."EV_SystemConfig" (key, value, description, is_active, updated_at)
VALUES (
  'payment_gateway',
  '{"testing_mode":true,"test_gateway":"razorpay","production_gateway":"hdfc","active_currency":"INR","gst_enabled":true}'::text,
  'Active payment gateway: testing_mode true = Razorpay, false = HDFC',
  true,
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET
  description = COALESCE(EXCLUDED.description, public."EV_SystemConfig".description),
  is_active = true,
  updated_at = CASE
    WHEN public."EV_SystemConfig".value IS NULL OR public."EV_SystemConfig".value = ''
    THEN NOW()
    ELSE public."EV_SystemConfig".updated_at
  END,
  value = CASE
    WHEN public."EV_SystemConfig".value IS NULL OR public."EV_SystemConfig".value = ''
    THEN EXCLUDED.value
    ELSE public."EV_SystemConfig".value
  END;

-- Ensure required JSON keys exist without wiping admin changes
UPDATE public."EV_SystemConfig"
SET value = (
  COALESCE(value::jsonb, '{}'::jsonb)
  || jsonb_build_object(
    'testing_mode', COALESCE((value::jsonb)->>'testing_mode', 'true')::boolean,
    'test_gateway', COALESCE((value::jsonb)->>'test_gateway', 'razorpay'),
    'production_gateway', COALESCE((value::jsonb)->>'production_gateway', 'hdfc'),
    'active_currency', COALESCE((value::jsonb)->>'active_currency', 'INR'),
    'gst_enabled', COALESCE(((value::jsonb)->>'gst_enabled')::boolean, true)
  )
)::text,
  updated_at = NOW()
WHERE key = 'payment_gateway'
  AND (
    value IS NULL
    OR value = ''
    OR NOT (value::jsonb ? 'testing_mode')
    OR NOT (value::jsonb ? 'test_gateway')
    OR NOT (value::jsonb ? 'production_gateway')
  );

-- ---------------------------------------------------------------------------
-- 3) Payment table gateway snapshot columns
-- ---------------------------------------------------------------------------
ALTER TABLE public."EV_PaymentOrders"
  ADD COLUMN IF NOT EXISTS gateway TEXT,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_gateway_response JSONB;

ALTER TABLE public."EV_PaymentTransactions"
  ADD COLUMN IF NOT EXISTS gateway TEXT,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_signature TEXT,
  ADD COLUMN IF NOT EXISTS gateway_status TEXT,
  ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_gateway_response JSONB;

ALTER TABLE public."EV_Payments"
  ADD COLUMN IF NOT EXISTS gateway TEXT,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS testing_mode BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS raw_gateway_response JSONB;

-- Backfill gateway from gateway_name where present
UPDATE public."EV_PaymentOrders"
SET gateway = COALESCE(gateway, gateway_name)
WHERE gateway IS NULL AND gateway_name IS NOT NULL;

UPDATE public."EV_PaymentTransactions"
SET gateway = COALESCE(gateway, gateway_name)
WHERE gateway IS NULL AND gateway_name IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Public + admin RPCs (no secrets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ev_parse_payment_gateway_config(p_raw TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v JSONB;
  testing_mode BOOLEAN;
  test_gw TEXT;
  prod_gw TEXT;
BEGIN
  BEGIN
    v := COALESCE(p_raw::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v := '{}'::jsonb;
  END;

  testing_mode := COALESCE((v->>'testing_mode')::boolean, true);
  test_gw := lower(COALESCE(v->>'test_gateway', 'razorpay'));
  prod_gw := lower(COALESCE(v->>'production_gateway', 'hdfc'));

  RETURN jsonb_build_object(
    'testing_mode', testing_mode,
    'test_gateway', test_gw,
    'production_gateway', prod_gw,
    'active_gateway', CASE WHEN testing_mode THEN test_gw ELSE prod_gw END,
    'active_currency', COALESCE(v->>'active_currency', 'INR'),
    'gst_enabled', COALESCE((v->>'gst_enabled')::boolean, true)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ev_get_payment_gateway_public()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_raw TEXT;
BEGIN
  SELECT value INTO v_raw
  FROM public."EV_SystemConfig"
  WHERE key = 'payment_gateway' AND COALESCE(is_active, true) = true
  LIMIT 1;

  RETURN public.ev_parse_payment_gateway_config(v_raw);
END;
$$;

CREATE OR REPLACE FUNCTION public.ev_get_payment_gateway_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN public.ev_get_payment_gateway_public();
END;
$$;

CREATE OR REPLACE FUNCTION public.ev_set_payment_gateway_testing_mode(
  p_admin_user_id UUID,
  p_testing_mode BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_raw TEXT;
  v_cfg JSONB;
  v_next JSONB;
BEGIN
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Admin user required';
  END IF;

  SELECT role INTO v_role FROM public."EV_Users" WHERE id = p_admin_user_id;
  IF v_role IS NULL OR v_role NOT IN ('SuperAdmin', 'Admin') THEN
    RAISE EXCEPTION 'Only SuperAdmin can change payment gateway mode';
  END IF;

  SELECT value INTO v_raw
  FROM public."EV_SystemConfig"
  WHERE key = 'payment_gateway'
  LIMIT 1;

  v_cfg := public.ev_parse_payment_gateway_config(v_raw);
  v_next := v_cfg || jsonb_build_object(
    'testing_mode', COALESCE(p_testing_mode, true),
    'test_gateway', 'razorpay',
    'production_gateway', 'hdfc'
  );
  v_next := v_next || jsonb_build_object(
    'active_gateway',
    CASE WHEN COALESCE(p_testing_mode, true)
      THEN 'razorpay'
      ELSE 'hdfc'
    END
  );

  INSERT INTO public."EV_SystemConfig" (key, value, description, is_active, updated_at)
  VALUES (
    'payment_gateway',
    v_next::text,
    'Active payment gateway: testing_mode true = Razorpay, false = HDFC',
    true,
    NOW()
  )
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = NOW();

  INSERT INTO public."EV_AuditLogs" (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_admin_user_id,
    CASE WHEN COALESCE(p_testing_mode, true) THEN 'Enabled Payment Testing Mode' ELSE 'Disabled Payment Testing Mode' END,
    'SystemConfig',
    'payment_gateway',
    format(
      'Payment testing_mode=%s active_gateway=%s',
      COALESCE(p_testing_mode, true),
      CASE WHEN COALESCE(p_testing_mode, true) THEN 'razorpay' ELSE 'hdfc' END
    )
  );

  RETURN public.ev_get_payment_gateway_public();
END;
$$;

GRANT EXECUTE ON FUNCTION public.ev_get_payment_gateway_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ev_get_payment_gateway_config() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ev_set_payment_gateway_testing_mode(UUID, BOOLEAN) TO anon, authenticated;

COMMENT ON FUNCTION public.ev_get_payment_gateway_public() IS
  'Safe payment gateway config for mobile/web (no secrets). testing_mode true = Razorpay.';
COMMENT ON FUNCTION public.ev_set_payment_gateway_testing_mode(UUID, BOOLEAN) IS
  'SuperAdmin-only toggle. true = Razorpay testing, false = HDFC production.';
