import { useCallback, useEffect, useState } from "react";
import type { Charger, ChargingSession, DashboardStats } from "@/types/ev";
import type { TimeRange } from "@/types/ev";
import * as chargerService from "@/services/chargerService";
import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { PREFERENCES_UPDATED_EVENT } from "@/utils/userPreferencesStore";

export function useDashboardData(timeRange: TimeRange = "today") {
  const { systemSettings } = useUserPreferences();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [activeSessions, setActiveSessions] = useState<ChargingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const onPrefsUpdated = () => setRefreshTick((v) => v + 1);
    window.addEventListener(PREFERENCES_UPDATED_EVENT, onPrefsUpdated);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, onPrefsUpdated);
  }, []);

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

  useEffect(() => {
    const ms = Math.max(5000, systemSettings.autoRefreshInterval * 1000);
    const timer = setInterval(refresh, ms);
    return () => clearInterval(timer);
  }, [refresh, systemSettings.autoRefreshInterval, refreshTick]);

  return { stats, chargers, activeSessions, loading, refresh };
}
