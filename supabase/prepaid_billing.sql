-- Prepaid-only charging (no postpaid product path).
-- Run in Supabase SQL Editor after schema.sql / tariff_billing.sql.

-- =============================================================================
-- Prepaid plan presets (admin CRUD)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EV_PrepaidPlans" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('amount', 'time')),
  value NUMERIC(12, 2) NOT NULL CHECK (value > 0),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "EV_PrepaidPlans" IS 'Admin presets: pay-before-charge by amount (INR) or time (minutes)';
COMMENT ON COLUMN "EV_PrepaidPlans".mode IS 'amount = INR prepaid; time = minutes prepaid';
COMMENT ON COLUMN "EV_PrepaidPlans".value IS 'INR when mode=amount; minutes when mode=time';

CREATE INDEX IF NOT EXISTS idx_ev_prepaid_plans_active_sort
  ON "EV_PrepaidPlans" (is_active, sort_order, mode);

ALTER TABLE "EV_PrepaidPlans" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ev_anon_select_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_select_prepaid_plans" ON "EV_PrepaidPlans"
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ev_anon_insert_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_insert_prepaid_plans" ON "EV_PrepaidPlans"
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_update_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_update_prepaid_plans" ON "EV_PrepaidPlans"
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ev_anon_delete_prepaid_plans" ON "EV_PrepaidPlans";
CREATE POLICY "ev_anon_delete_prepaid_plans" ON "EV_PrepaidPlans"
  FOR DELETE TO anon, authenticated USING (true);

-- Seed defaults (idempotent by label+mode+value)
INSERT INTO "EV_PrepaidPlans" (mode, value, label, sort_order, is_active)
SELECT v.mode, v.value, v.label, v.sort_order, true
FROM (
  VALUES
    ('amount'::text, 50::numeric, '₹50'::text, 10),
    ('amount', 100, '₹100', 20),
    ('amount', 500, '₹500', 30),
    ('time', 10, '10 min', 40),
    ('time', 15, '15 min', 50),
    ('time', 30, '30 min', 60),
    ('time', 60, '1 hour', 70)
) AS v(mode, value, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "EV_PrepaidPlans" p
  WHERE p.mode = v.mode AND p.value = v.value
);

-- =============================================================================
-- Session prepaid fields
-- =============================================================================

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS prepaid_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_total_inr NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_energy_cap_kwh NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS prepaid_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepaid_payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_plan_id UUID REFERENCES "EV_PrepaidPlans"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ev_charging_sessions_prepaid_mode_check'
  ) THEN
    ALTER TABLE "EV_ChargingSessions"
      ADD CONSTRAINT ev_charging_sessions_prepaid_mode_check
      CHECK (prepaid_mode IS NULL OR prepaid_mode IN ('amount', 'time'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ev_charging_sessions_settlement_status_check'
  ) THEN
    ALTER TABLE "EV_ChargingSessions"
      ADD CONSTRAINT ev_charging_sessions_settlement_status_check
      CHECK (
        settlement_status IS NULL
        OR settlement_status IN ('paid', 'active', 'settled', 'refunded', 'failed_start')
      );
  END IF;
END $$;

COMMENT ON COLUMN "EV_ChargingSessions".prepaid_mode IS 'amount | time — prepaid-only product';
COMMENT ON COLUMN "EV_ChargingSessions".prepaid_total_inr IS 'Amount collected before start (incl. GST)';
COMMENT ON COLUMN "EV_ChargingSessions".settlement_status IS 'paid→active→settled/refunded';

CREATE INDEX IF NOT EXISTS idx_ev_sessions_prepaid_expires
  ON "EV_ChargingSessions" (prepaid_expires_at)
  WHERE status = 'active' AND prepaid_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ev_sessions_settlement_status
  ON "EV_ChargingSessions" (settlement_status)
  WHERE settlement_status IS NOT NULL;

-- =============================================================================
-- Charger lab bypass (admin Start without prepaid — test only)
-- =============================================================================

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS allow_admin_bypass BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "EV_Chargers".allow_admin_bypass IS
  'When true, web admin may RemoteStart without prepaid (lab/test). Production should stay false.';

-- =============================================================================
-- Payments: kind (prepaid charging | refund) — no postpaid product path
-- =============================================================================

ALTER TABLE "EV_Payments"
  ADD COLUMN IF NOT EXISTS payment_kind TEXT;

UPDATE "EV_Payments"
SET payment_kind = 'prepaid'
WHERE payment_kind IS NULL;

ALTER TABLE "EV_Payments"
  ALTER COLUMN payment_kind SET DEFAULT 'prepaid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ev_payments_payment_kind_check'
  ) THEN
    ALTER TABLE "EV_Payments"
      ADD CONSTRAINT ev_payments_payment_kind_check
      CHECK (payment_kind IN ('prepaid', 'refund'));
  END IF;
END $$;

COMMENT ON COLUMN "EV_Payments".payment_kind IS 'prepaid = charging pay-before-start; refund = unused prepaid return';

-- =============================================================================
-- Settlement helper (gateway / stop path)
-- =============================================================================

CREATE OR REPLACE FUNCTION ev_settle_prepaid_session(p_session_id UUID)
RETURNS TABLE (
  session_id UUID,
  prepaid_total NUMERIC,
  actual_total NUMERIC,
  refund_amount NUMERIC,
  settlement_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess RECORD;
  v_bill RECORD;
  v_actual NUMERIC;
  v_prepaid NUMERIC;
  v_refund NUMERIC;
  v_status TEXT;
BEGIN
  SELECT *
  INTO v_sess
  FROM "EV_ChargingSessions" s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  v_prepaid := COALESCE(v_sess.prepaid_total_inr, 0);

  SELECT *
  INTO v_bill
  FROM ev_calculate_session_bill(COALESCE(v_sess.energy_kwh, 0), v_sess.tariff_id)
  LIMIT 1;

  v_actual := COALESCE(v_bill.total_amount, 0);
  v_refund := GREATEST(0, ROUND(v_prepaid - v_actual, 2));
  v_status := CASE WHEN v_refund > 0 THEN 'refunded' ELSE 'settled' END;

  UPDATE "EV_ChargingSessions"
  SET
    amount = v_bill.amount,
    settlement_amount = v_actual,
    refund_amount = v_refund,
    settlement_status = v_status,
    updated_at = NOW()
  WHERE id = p_session_id;

  -- Keep pending/success payment amounts in sync with actual billed (prepaid collected separately).
  UPDATE "EV_Payments"
  SET
    amount = v_bill.amount,
    gst_amount = v_bill.gst_amount,
    total_amount = CASE
      WHEN status IN ('success', 'paid') THEN COALESCE(total_amount, v_prepaid)
      ELSE v_actual
    END,
    payment_kind = COALESCE(payment_kind, 'prepaid'),
    updated_at = NOW()
  WHERE session_id = p_session_id
    AND COALESCE(payment_kind, 'prepaid') = 'prepaid';

  RETURN QUERY
  SELECT p_session_id, v_prepaid, v_actual, v_refund, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION ev_settle_prepaid_session(UUID) TO anon, authenticated, service_role;
