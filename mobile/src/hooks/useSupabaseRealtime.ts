import { useEffect } from "react";
import { supabase } from "../utils/supabaseClient";

export function useSupabaseRealtime(onChange: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled || !supabase) return;

    const channel = supabase
      .channel("ev-mobile-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "EV_Chargers" }, () => onChange())
      .on("postgres_changes", { event: "*", schema: "public", table: "EV_ChargingSessions" }, () => onChange())
      .on("postgres_changes", { event: "*", schema: "public", table: "EV_MeterValues" }, () => onChange())
      .subscribe();

    return () => {
      if (supabase) supabase.removeChannel(channel);
    };
  }, [onChange, enabled]);
}
