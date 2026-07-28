-- Session attribution columns (safe to run).
-- Web admin uses ADMIN-BYPASS idTag at OCPP; session user_id comes from logged-in admin.

ALTER TABLE public."EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS started_by TEXT;

COMMENT ON COLUMN public."EV_ChargingSessions".started_by IS
  'mobile | rfid | admin — who initiated charging';

COMMENT ON COLUMN public."EV_ChargingSessions".authorization_method IS
  'Mobile | RFID | Remote (admin ADMIN-BYPASS) | legacy values';

-- Ensure ADMIN-BYPASS RFID exists and is active for web admin Authorize.
INSERT INTO public."EV_RFIDCards" (uid, status, total_sessions, created_at, updated_at)
SELECT 'ADMIN-BYPASS', 'active', 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public."EV_RFIDCards" WHERE upper(uid) = 'ADMIN-BYPASS'
);

UPDATE public."EV_RFIDCards"
SET status = 'active',
    updated_at = NOW()
WHERE upper(uid) = 'ADMIN-BYPASS'
  AND lower(status) = 'blocked';

-- Web admin start enabled by default on all chargers.
ALTER TABLE public."EV_Chargers"
  ADD COLUMN IF NOT EXISTS allow_admin_bypass BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public."EV_Chargers"
  ALTER COLUMN allow_admin_bypass SET DEFAULT true;

UPDATE public."EV_Chargers"
SET allow_admin_bypass = true,
    updated_at = NOW()
WHERE allow_admin_bypass IS DISTINCT FROM true;
