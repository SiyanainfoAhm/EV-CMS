-- Enable Supabase Realtime for EV-CMS tables (web bell, dashboard, mobile in-app).
-- Run after schema.sql. Safe to re-run (skips tables already in publication).

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'EV_Notifications',
    'EV_Chargers',
    'EV_ChargerConnectors',
    'EV_ChargingSessions',
    'EV_MeterValues',
    'EV_ChargerEvents',
    'EV_Payments'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;

-- Required for postgres_changes filters (e.g. user_id=eq.<uuid>) on notifications.
ALTER TABLE "EV_Notifications" REPLICA IDENTITY FULL;
