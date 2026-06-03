import { useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";

const TABLES = [
  "EV_Chargers",
  "EV_ChargerConnectors",
  "EV_ChargingSessions",
  "EV_MeterValues",
  "EV_ChargerEvents",
  "EV_Payments",
  "EV_Notifications",
] as const;

/** Refetch when simulator or gateway writes to core EV tables. */
export function useSupabaseRealtime(onChange: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled || !supabase) return;

    const channel = supabase
      .channel("ev-cms-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "EV_Chargers" },
        () => onChange()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "EV_ChargingSessions" },
        () => onChange()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "EV_MeterValues" },
        () => onChange()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "EV_ChargerEvents" },
        () => onChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onChange, enabled]);
}

export { TABLES };
