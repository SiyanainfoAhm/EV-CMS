import { useCallback, useEffect, useState } from "react";
import type { Charger, ChargingSession, DashboardStats } from "@/types/ev";
import type { TimeRange } from "@/types/ev";
import * as chargerService from "@/services/chargerService";
import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";

export function useDashboardData(timeRange: TimeRange = "today") {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [activeSessions, setActiveSessions] = useState<ChargingSession[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    Promise.all([
      chargerService.getDashboardStats(timeRange),
      chargerService.getChargers(),
      chargerService.getActiveSessionsForChargers(),
    ])
      .then(([s, c, sessions]) => {
        setStats(s);
        setChargers(c);
        setActiveSessions(sessions as ChargingSession[]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useSupabaseRealtime(refresh);

  return { stats, chargers, activeSessions, loading, refresh };
}
