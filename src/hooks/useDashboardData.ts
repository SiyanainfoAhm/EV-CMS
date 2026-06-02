import { useEffect, useState } from "react";
import type { Charger, ChargingSession, DashboardStats } from "@/types/ev";
import type { TimeRange } from "@/types/ev";
import * as chargerService from "@/services/chargerService";

export function useDashboardData(timeRange: TimeRange = "today") {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [activeSessions, setActiveSessions] = useState<ChargingSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      chargerService.getDashboardStats(timeRange),
      chargerService.getChargers(),
      chargerService.getActiveSessionsForChargers(),
    ]).then(([s, c, sessions]) => {
      setStats(s);
      setChargers(c);
      setActiveSessions(sessions as ChargingSession[]);
      setLoading(false);
    });
  }, [timeRange]);

  return { stats, chargers, activeSessions, loading };
}
