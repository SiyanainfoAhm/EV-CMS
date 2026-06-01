import { useEffect, useState } from "react";
import type { Charger, ChargingSession, DashboardStats } from "@/types/ev";
import * as chargerService from "@/services/chargerService";

export function useDashboardData() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [activeSessions, setActiveSessions] = useState<ChargingSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      chargerService.getDashboardStats(),
      chargerService.getChargers(),
      chargerService.getActiveSessionsForChargers(),
    ]).then(([s, c, sessions]) => {
      setStats(s);
      setChargers(c);
      setActiveSessions(sessions as ChargingSession[]);
      setLoading(false);
    });
  }, []);

  return { stats, chargers, activeSessions, loading };
}
