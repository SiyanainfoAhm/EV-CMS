-- Tariff-based session billing (kWh × rate, optional GST from tariff).
-- Run in Supabase SQL Editor after schema.sql.

ALTER TABLE "EV_Tariffs"
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "EV_Tariffs".region IS 'Geographic label e.g. Noida, Uttar Pradesh';
COMMENT ON COLUMN "EV_Tariffs".is_default IS 'Default tariff for new sessions when no charger override is set';

CREATE INDEX IF NOT EXISTS idx_ev_tariffs_is_default ON "EV_Tariffs" (is_default) WHERE is_default = true;

CREATE OR REPLACE FUNCTION ev_get_default_tariff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id
  FROM "EV_Tariffs"
  WHERE is_active = true AND is_default = true
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION ev_resolve_tariff_id(p_tariff_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_tariff_id IS NOT NULL THEN
    SELECT t.id
    INTO v_id
    FROM "EV_Tariffs" t
    WHERE t.id = p_tariff_id AND t.is_active = true;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  v_id := ev_get_default_tariff_id();
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT t.id
  INTO v_id
  FROM "EV_Tariffs" t
  WHERE t.is_active = true
  ORDER BY t.created_at
  LIMIT 1;

  RETURN v_id;
END;
$$;

-- Bill = consumed kWh × rate_per_kwh; GST applied when tariff.gst_percent > 0.
CREATE OR REPLACE FUNCTION ev_calculate_session_bill(
  p_energy_kwh NUMERIC,
  p_tariff_id UUID DEFAULT NULL
)
RETURNS TABLE (
  tariff_id UUID,
  rate_per_kwh NUMERIC,
  gst_percent NUMERIC,
  amount NUMERIC,
  gst_amount NUMERIC,
  total_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tariff_id UUID;
  v_rate NUMERIC;
  v_gst_pct NUMERIC;
  v_energy NUMERIC;
  v_amount NUMERIC;
  v_gst NUMERIC;
BEGIN
  v_energy := GREATEST(COALESCE(p_energy_kwh, 0), 0);
  v_tariff_id := ev_resolve_tariff_id(p_tariff_id);

  IF v_tariff_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_TARIFF';
  END IF;

  SELECT t.rate_per_kwh, t.gst_percent
  INTO v_rate, v_gst_pct
  FROM "EV_Tariffs" t
  WHERE t.id = v_tariff_id;

  v_amount := ROUND(v_energy * v_rate, 2);
  v_gst := CASE
    WHEN COALESCE(v_gst_pct, 0) > 0 THEN ROUND(v_amount * v_gst_pct / 100, 2)
    ELSE 0
  END;

  RETURN QUERY
  SELECT
    v_tariff_id,
    v_rate,
    COALESCE(v_gst_pct, 0),
    v_amount,
    v_gst,
    v_amount + v_gst;
END;
$$;

-- Temporary default: Noida / Uttar Pradesh @ ₹7.70/kWh (admin can update rate or GST in EV_Tariffs).
INSERT INTO "EV_Tariffs" (
  id, name, rate_per_kwh, session_fee, gst_percent, applies_to, is_active, is_default, region, created_at
) VALUES (
  'e0000001-0000-4000-8000-000000000010',
  'Noida / UP — Standard (Temporary)',
  7.70,
  0,
  18,
  'All',
  true,
  true,
  'Noida, Uttar Pradesh',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  rate_per_kwh = EXCLUDED.rate_per_kwh,
  session_fee = EXCLUDED.session_fee,
  gst_percent = EXCLUDED.gst_percent,
  applies_to = EXCLUDED.applies_to,
  is_active = EXCLUDED.is_active,
  is_default = EXCLUDED.is_default,
  region = EXCLUDED.region,
  updated_at = NOW();

UPDATE "EV_Tariffs"
SET is_default = false, updated_at = NOW()
WHERE id <> 'e0000001-0000-4000-8000-000000000010'
  AND is_default = true;

GRANT EXECUTE ON FUNCTION ev_get_default_tariff_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_resolve_tariff_id(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ev_calculate_session_bill(NUMERIC, UUID) TO anon, authenticated;
