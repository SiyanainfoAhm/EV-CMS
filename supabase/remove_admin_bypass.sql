-- Optional: session attribution columns (safe to run; does not constrain old Admin Bypass rows).
-- Do NOT add CHECK (auth_method IN (...)) until legacy Admin Bypass rows are cleaned up.

ALTER TABLE public."EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS started_by TEXT;

COMMENT ON COLUMN public."EV_ChargingSessions".started_by IS
  'mobile | rfid — who initiated charging (Admin Bypass removed)';

COMMENT ON COLUMN public."EV_ChargingSessions".authorization_method IS
  'Mobile | RFID (legacy Admin Bypass / Remote / QR display as Legacy / Unknown in UI)';

-- Deactivate shared ADMIN-BYPASS RFID cards so they cannot authorize new sessions.
UPDATE public."EV_RFIDCards"
SET status = 'blocked',
    updated_at = NOW()
WHERE upper(uid) = 'ADMIN-BYPASS'
  AND lower(status) = 'active';
