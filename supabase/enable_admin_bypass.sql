-- Enable lab admin bypass on ALL chargers (fixes mobile RemoteStart without RFID).
-- Run in Supabase SQL Editor, then retry mobile Start.

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS allow_admin_bypass BOOLEAN NOT NULL DEFAULT true;

UPDATE "EV_Chargers"
SET allow_admin_bypass = true,
    updated_at = NOW();

-- Verify
SELECT charge_point_id, name, allow_admin_bypass
FROM "EV_Chargers"
ORDER BY name;
