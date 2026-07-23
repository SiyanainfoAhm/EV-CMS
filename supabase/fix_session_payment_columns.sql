-- Fix: EV_ChargingSessions missing prepaid/payment columns (amount_due, etc.)
-- Run once in Supabase SQL Editor.

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS payment_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS amount_due NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepaid_mode TEXT,
  ADD COLUMN IF NOT EXISTS prepaid_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_total_inr NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS prepaid_energy_cap_kwh NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS prepaid_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepaid_payment_id UUID,
  ADD COLUMN IF NOT EXISTS prepaid_plan_id UUID,
  ADD COLUMN IF NOT EXISTS settlement_status TEXT,
  ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS target_kwh NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS authorization_method TEXT;

COMMENT ON COLUMN "EV_ChargingSessions".amount_due IS
  'Post-session amount still owed; must stay 0 for prepaid sessions';
