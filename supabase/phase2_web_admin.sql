-- Phase 2 web admin — run after schema.sql + policies_write.sql

-- Session auth method (RFID / Mobile / QR / Remote)
ALTER TABLE "EV_ChargingSessions"
  ADD COLUMN IF NOT EXISTS authorization_method TEXT;

COMMENT ON COLUMN "EV_ChargingSessions".authorization_method IS 'RFID | Mobile | QR | Remote | Admin';

-- Archive sessions older than 1 year (run via pg_cron or manual admin job)
CREATE OR REPLACE FUNCTION archive_ev_sessions_older_than_one_year()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '1 year';
  v_count INTEGER;
BEGIN
  WITH moved AS (
    DELETE FROM "EV_ChargingSessions"
    WHERE status IN ('completed', 'stopped', 'faulted')
      AND COALESCE(end_time, start_time) < v_cutoff
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM moved;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION archive_ev_sessions_older_than_one_year IS 'Phase 2 data retention — removes session rows older than 1 year';

GRANT EXECUTE ON FUNCTION archive_ev_sessions_older_than_one_year() TO anon, authenticated;
