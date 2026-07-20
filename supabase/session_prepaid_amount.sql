-- Optional prepaid amount / target kWh entered before start (petrol-pump style).
-- Run in Supabase SQL Editor.

ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS target_kwh NUMERIC(12, 3);

COMMENT ON COLUMN "EV_ChargingSessions".prepaid_amount IS
  'User-requested spend amount (₹) entered before charging';
COMMENT ON COLUMN "EV_ChargingSessions".target_kwh IS
  'User-requested energy (kWh) entered before charging';
