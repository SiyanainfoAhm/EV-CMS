import { useCallback, useEffect, useRef, useState } from "react";
import type { Charger, ChargingSession, DashboardStats } from "@/types/ev";
import type { DashboardRange } from "@/utils/dateRanges";
import { dashboardRangeKey } from "@/utils/dateRanges";
import type { TimeRange } from "@/types/ev";
import * as chargerService from "@/services/chargerService";
import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { PREFERENCES_UPDATED_EVENT } from "@/utils/userPreferencesStore";

export function useDashboardData(range: DashboardRange | TimeRange = "today") {
  const { systemSettings } = useUserPreferences();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [activeSessions, setActiveSessions] = useState<ChargingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const rangeKey = dashboardRangeKey(range);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    const onPrefsUpdated = () => setRefreshTick((v) => v + 1);
    window.addEventListener(PREFERENCES_UPDATED_EVENT, onPrefsUpdated);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, onPrefsUpdated);
  }, []);

  const fetchData = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true);
    try {
      const [s, c, sessions] = await Promise.all([
        chargerService.getDashboardStats(rangeRef.current),
        chargerService.getChargers(),
        chargerService.getActiveSessionsForChargers(),
      ]);
      setStats(s);
      setChargers(c);
      setActiveSessions(sessions as ChargingSession[]);
    } catch (e) {
      console.error(e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [rangeKey]);

  const refresh = useCallback(() => {
    void fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    void fetchData(true);
  }, [fetchData]);

  useSupabaseRealtime(refresh);

  useEffect(() => {
    const ms = Math.max(30000, systemSettings.autoRefreshInterval * 1000);
    const timer = setInterval(refresh, ms);
    return () => clearInterval(timer);
  }, [refresh, systemSettings.autoRefreshInterval, refreshTick]);

  return { stats, chargers, activeSessions, loading, refresh };
}
