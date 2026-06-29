-- Internal config (RLS enabled, no policies — service role + SECURITY DEFINER only).
CREATE TABLE IF NOT EXISTS "EV_SystemConfig" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "EV_SystemConfig" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION ev_get_system_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT value FROM "EV_SystemConfig" WHERE key = p_key LIMIT 1;
$$;

-- Set push dispatch secret (must match what the edge function validates):
-- INSERT INTO "EV_SystemConfig" (key, value) VALUES ('ev_push_dispatch_secret', 'your-secret')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
