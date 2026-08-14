-- Optional display label for chargers (web + mobile share the same source of truth).
-- Do NOT auto-fill with generated names — leave NULL; fall back to name / charge_point_id in app code.

ALTER TABLE public."EV_Chargers"
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN public."EV_Chargers".display_name IS
  'Optional public label. If empty, apps show name, then charge_point_id.';
