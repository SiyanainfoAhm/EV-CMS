import type { Charger, ChargingSession } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { utcRangeStart } from "@/utils/dateRanges";
import { connectivityFromHeartbeat } from "@/utils/chargerConnectivity";

export interface DailyChartPoint {
  day: string;
  revenue: number;
  sessions: number;
}

export interface UserWiseReportRow {
  userId: string;
  userName: string;
  sessions: number;
  energyKwh: number;
  revenue: number;
}

export interface FaultOfflineRow {
  chargePointId: string;
  name: string;
  status: string;
  connectivity: string;
  location: string;
  lastHeartbeat: string;
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${day}`;
}

function lastNDays(n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

export async function getDailyRevenueAndSessions(days = 7): Promise<DailyChartPoint[]> {
  const supabase = requireSupabase();
  const since = utcRangeStart(days);

  const [paymentsRes, sessionsRes] = await Promise.all([
    supabase
      .from("EV_Payments")
      .select("total_amount, created_at, status")
      .gte("created_at", since.toISOString())
      .eq("status", "success"),
    supabase
      .from("EV_ChargingSessions")
      .select("id, start_time")
      .eq("status", "completed")
      .gte("start_time", since.toISOString()),
  ]);

  if (paymentsRes.error) throw paymentsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const dayKeys = lastNDays(days);
  const byDay = new Map<string, DailyChartPoint>(
    dayKeys.map((k) => [k, { day: formatDayLabel(k), revenue: 0, sessions: 0 }])
  );

  for (const row of paymentsRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const key = new Date(r.created_at as string).toISOString().slice(0, 10);
    const point = byDay.get(key);
    if (point) point.revenue += Number(r.total_amount ?? 0);
  }

  for (const row of sessionsRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const key = new Date(r.start_time as string).toISOString().slice(0, 10);
    const point = byDay.get(key);
    if (point) point.sessions += 1;
  }

  return dayKeys.map((k) => byDay.get(k)!);
}

export async function getUserWiseReport(days = 30): Promise<UserWiseReportRow[]> {
  const since = utcRangeStart(days);
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("user_id, energy_kwh, amount, EV_Users(full_name)")
    .neq("status", "active")
    .gte("start_time", since.toISOString());

  if (error) throw error;

  const byUser = new Map<string, UserWiseReportRow>();
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const userId = r.user_id as string;
    const user = r.EV_Users as Record<string, unknown> | null;
    const name = (user?.full_name as string) ?? "Unknown";
    const existing = byUser.get(userId) ?? { userId, userName: name, sessions: 0, energyKwh: 0, revenue: 0 };
    existing.sessions += 1;
    existing.energyKwh += Number(r.energy_kwh ?? 0);
    existing.revenue += Number(r.amount ?? 0);
    byUser.set(userId, existing);
  }

  return [...byUser.values()].sort((a, b) => b.revenue - a.revenue);
}

export async function getFaultOfflineReport(): Promise<FaultOfflineRow[]> {
  const { data, error } = await requireSupabase()
    .from("EV_Chargers")
    .select("charge_point_id, name, status, location, last_heartbeat_at")
    .order("name");

  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const r = row as Record<string, unknown>;
      const hb = r.last_heartbeat_at as string | null;
      const connectivity = connectivityFromHeartbeat(hb);
      const status = r.status as string;
      return {
        chargePointId: r.charge_point_id as string,
        name: r.name as string,
        status,
        connectivity,
        location: (r.location as string) ?? "",
        lastHeartbeat: hb ?? "Never",
      };
    })
    .filter((c) => c.status === "faulted" || c.status === "offline" || c.connectivity !== "online");
}

export function sessionsInRange(sessions: ChargingSession[], days: number): ChargingSession[] {
  const start = utcRangeStart(days).getTime();
  return sessions.filter((s) => new Date(s.startTime).getTime() >= start);
}

export function energyByCharger(
  chargers: Charger[],
  sessions: ChargingSession[]
): { chargePointId: string; name: string; energy: number; sessions: number }[] {
  return chargers.map((c) => {
    const matched = sessions.filter((s) => s.chargePointId === c.chargePointId);
    return {
      chargePointId: c.chargePointId,
      name: c.name,
      energy: parseFloat(matched.reduce((sum, s) => sum + (s.energyKwh || 0), 0).toFixed(2)),
      sessions: matched.length,
    };
  });
}
