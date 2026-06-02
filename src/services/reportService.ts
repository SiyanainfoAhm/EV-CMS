import { requireSupabase } from "@/utils/supabaseClient";

export interface DailyChartPoint {
  day: string;
  revenue: number;
  sessions: number;
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
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  // Use UTC boundaries so seeded UTC timestamps match day buckets.
  since.setUTCHours(0, 0, 0, 0);

  const [paymentsRes, sessionsRes] = await Promise.all([
    supabase
      .from("EV_Payments")
      .select("total_amount, created_at, status")
      .gte("created_at", since.toISOString())
      // Seed data uses `success`/`pending` (not `completed`) for EV_Payments.
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
