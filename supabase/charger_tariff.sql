-- Per-charger tariff override (run on VBDC Supabase after schema.sql)
-- NULL tariff_id = use active type default (DC Fast / AC Slow)

ALTER TABLE "EV_Chargers"
  ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES "EV_Tariffs"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ev_chargers_tariff_id ON "EV_Chargers" (tariff_id);

COMMENT ON COLUMN "EV_Chargers".tariff_id IS 'Optional tariff override; NULL uses active EV_Tariffs by charger_type';
