import type { Charger, ChargingSession } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { utcRangeStart } from "@/utils/dateRanges";
import { connectivityFromHeartbeat } from "@/utils/chargerConnectivity";
import { mapSession } from "@/utils/supabaseMappers";
import { loadUserDisplayNameMap } from "@/utils/sessionUserNames";

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

export interface ChargerUsageRow {
  chargePointId: string;
  chargerName: string;
  energyKwh: number;
  sessions: number;
}

export interface ReportSummary {
  totalEnergyKwh: number;
  totalSessions: number;
  /** Net prepaid collections minus refunds */
  totalRevenue: number;
  totalRefunds: number;
  avgEnergyPerSession: number;
}

/** Signed contribution to prepaid revenue (refunds reduce net). */
function prepaidPaymentDelta(row: { total_amount?: unknown; payment_kind?: unknown }): number {
  const amount = Number(row.total_amount ?? 0);
  const kind = (row.payment_kind as string | null) ?? "prepaid";
  if (kind === "refund") return -Math.abs(amount);
  return amount;
}

export interface ReportDateBounds {
  start: Date;
  end: Date;
}

export interface ReportsBundle {
  summary: ReportSummary;
  chargerUsage: ChargerUsageRow[];
  dailyChart: DailyChartPoint[];
  userWise: UserWiseReportRow[];
  sessions: ChargingSession[];
}

const sessionSelect = `
  *,
  EV_Chargers ( name, charge_point_id ),
  EV_Users ( full_name ),
  EV_RFIDCards ( uid )
`;

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${day}`;
}

function dayKeysBetween(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setUTCHours(0, 0, 0, 0);
  for (; cursor.getTime() <= endDay.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    keys.push(cursor.toISOString().slice(0, 10));
  }
  return keys;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getDailyRevenueAndSessionsForRange(
  range: ReportDateBounds
): Promise<DailyChartPoint[]> {
  const supabase = requireSupabase();
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();

  const [paymentsRes, sessionsRes] = await Promise.all([
    supabase
      .from("EV_Payments")
      .select("total_amount, created_at, status, payment_kind")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .eq("status", "success"),
    supabase
      .from("EV_ChargingSessions")
      .select("id, start_time")
      .eq("status", "completed")
      .gte("start_time", startIso)
      .lte("start_time", endIso),
  ]);

  if (paymentsRes.error) throw paymentsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const dayKeys = dayKeysBetween(range.start, range.end);
  const byDay = new Map<string, DailyChartPoint>(
    dayKeys.map((k) => [k, { day: formatDayLabel(k), revenue: 0, sessions: 0 }])
  );

  for (const row of paymentsRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const kind = (r.payment_kind as string | null) ?? "prepaid";
    if (kind !== "prepaid" && kind !== "refund") continue;
    const key = new Date(r.created_at as string).toISOString().slice(0, 10);
    const point = byDay.get(key);
    if (point) point.revenue += prepaidPaymentDelta(r);
  }

  for (const row of sessionsRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const key = new Date(r.start_time as string).toISOString().slice(0, 10);
    const point = byDay.get(key);
    if (point) point.sessions += 1;
  }

  return dayKeys.map((k) => byDay.get(k)!);
}

export async function getDailyRevenueAndSessions(days = 7): Promise<DailyChartPoint[]> {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return getDailyRevenueAndSessionsForRange({ start: utcRangeStart(days), end });
}

export async function getChargerUsageForRange(range: ReportDateBounds): Promise<ChargerUsageRow[]> {
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();

  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select("energy_kwh, EV_Chargers ( name, charge_point_id )")
    .gte("start_time", startIso)
    .lte("start_time", endIso)
    .in("status", ["completed", "active"]);

  if (error) throw error;

  const byCharger = new Map<string, ChargerUsageRow>();
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const charger = r.EV_Chargers as Record<string, unknown> | null;
    const cpId = (charger?.charge_point_id as string) ?? "unknown";
    const name = (charger?.name as string) ?? cpId;
    const existing = byCharger.get(cpId) ?? {
      chargePointId: cpId,
      chargerName: name,
      energyKwh: 0,
      sessions: 0,
    };
    existing.sessions += 1;
    existing.energyKwh += Number(r.energy_kwh ?? 0);
    byCharger.set(cpId, existing);
  }

  return [...byCharger.values()]
    .map((row) => ({ ...row, energyKwh: round1(row.energyKwh) }))
    .sort((a, b) => b.energyKwh - a.energyKwh);
}

export async function getSessionsForRange(range: ReportDateBounds): Promise<ChargingSession[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(sessionSelect)
    .gte("start_time", range.start.toISOString())
    .lte("start_time", range.end.toISOString())
    .neq("status", "active")
    .order("start_time", { ascending: false })
    .limit(10000);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const charger = r.EV_Chargers as Record<string, unknown> | null;
    const user = r.EV_Users as Record<string, unknown> | null;
    const rfid = r.EV_RFIDCards as Record<string, unknown> | null;
    return mapSession(r, charger, user, rfid);
  });
}

export async function getUserWiseReportForRange(range: ReportDateBounds): Promise<UserWiseReportRow[]> {
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();

  const [sessionsRes, paymentsRes] = await Promise.all([
    requireSupabase()
      .from("EV_ChargingSessions")
      .select("user_id, energy_kwh, EV_Users(full_name)")
      .gte("start_time", startIso)
      .lte("start_time", endIso)
      .eq("status", "completed"),
    requireSupabase()
      .from("EV_Payments")
      .select("user_id, total_amount, payment_kind, EV_Users(full_name)")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .eq("status", "success"),
  ]);

  if (sessionsRes.error) throw sessionsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const byUser = new Map<string, UserWiseReportRow>();
  const names = await loadUserDisplayNameMap();

  for (const row of sessionsRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const userId = r.user_id as string;
    const user = r.EV_Users as Record<string, unknown> | null;
    const name =
      (user?.full_name as string) ||
      names.get(userId) ||
      "Unknown";
    const existing = byUser.get(userId) ?? { userId, userName: name, sessions: 0, energyKwh: 0, revenue: 0 };
    existing.sessions += 1;
    existing.energyKwh += Number(r.energy_kwh ?? 0);
    if (existing.userName === "Unknown" && name !== "Unknown") {
      existing.userName = name;
    }
    byUser.set(userId, existing);
  }

  for (const row of paymentsRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const kind = (r.payment_kind as string | null) ?? "prepaid";
    if (kind !== "prepaid" && kind !== "refund") continue;
    const userId = r.user_id as string;
    const user = r.EV_Users as Record<string, unknown> | null;
    const name =
      (user?.full_name as string) ||
      names.get(userId) ||
      "Unknown";
    const existing = byUser.get(userId) ?? { userId, userName: name, sessions: 0, energyKwh: 0, revenue: 0 };
    existing.revenue += prepaidPaymentDelta(r);
    if (existing.userName === "Unknown" && name !== "Unknown") {
      existing.userName = name;
    }
    byUser.set(userId, existing);
  }

  return [...byUser.values()]
    .map((row) => ({
      ...row,
      energyKwh: round1(row.energyKwh),
      revenue: round2(row.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || b.energyKwh - a.energyKwh);
}

export async function getUserWiseReport(days = 30): Promise<UserWiseReportRow[]> {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return getUserWiseReportForRange({ start: utcRangeStart(days), end });
}

export async function getReportSummaryForRange(
  range: ReportDateBounds,
  dailyChart?: DailyChartPoint[],
  chargerUsage?: ChargerUsageRow[]
): Promise<ReportSummary> {
  const [chart, chargers, paymentsRes] = await Promise.all([
    dailyChart ? Promise.resolve(dailyChart) : getDailyRevenueAndSessionsForRange(range),
    chargerUsage ? Promise.resolve(chargerUsage) : getChargerUsageForRange(range),
    requireSupabase()
      .from("EV_Payments")
      .select("total_amount, payment_kind")
      .gte("created_at", range.start.toISOString())
      .lte("created_at", range.end.toISOString())
      .eq("status", "success"),
  ]);

  if (paymentsRes.error) throw paymentsRes.error;

  const totalEnergyKwh = round1(chargers.reduce((sum, c) => sum + c.energyKwh, 0));
  const totalSessions = chart.reduce((sum, d) => sum + d.sessions, 0);
  let grossPrepaid = 0;
  let totalRefunds = 0;
  for (const row of paymentsRes.data ?? []) {
    const r = row as { total_amount?: number; payment_kind?: string | null };
    const kind = r.payment_kind ?? "prepaid";
    if (kind === "refund") {
      totalRefunds += Math.abs(Number(r.total_amount ?? 0));
    } else if (kind === "prepaid") {
      grossPrepaid += Number(r.total_amount ?? 0);
    }
  }
  const totalRevenue = round2(grossPrepaid - totalRefunds);
  totalRefunds = round2(totalRefunds);
  const avgEnergyPerSession =
    totalSessions > 0 ? round1(totalEnergyKwh / totalSessions) : 0;

  return { totalEnergyKwh, totalSessions, totalRevenue, totalRefunds, avgEnergyPerSession };
}

export async function getReportsBundleForRange(range: ReportDateBounds): Promise<ReportsBundle> {
  const [dailyChart, chargerUsage, userWise, sessions] = await Promise.all([
    getDailyRevenueAndSessionsForRange(range),
    getChargerUsageForRange(range),
    getUserWiseReportForRange(range),
    getSessionsForRange(range),
  ]);

  const summary = await getReportSummaryForRange(range, dailyChart, chargerUsage);

  return { summary, chargerUsage, dailyChart, userWise, sessions };
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
