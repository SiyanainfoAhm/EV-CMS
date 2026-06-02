import type { ChargingSession } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapSession } from "@/utils/supabaseMappers";

function mapSessionRows(data: Record<string, unknown>[]): ChargingSession[] {
  return data.map((row) => {
    const charger = row.EV_Chargers as Record<string, unknown> | null;
    const user = row.EV_Users as Record<string, unknown> | null;
    const rfid = row.EV_RFIDCards as Record<string, unknown> | null;
    return mapSession(row, charger, user, rfid);
  });
}

const sessionSelect = `
  *,
  EV_Chargers ( name, charge_point_id ),
  EV_Users ( full_name ),
  EV_RFIDCards ( uid )
`;

export interface SessionsHistoryQuery {
  status?: string; // completed | stopped | faulted | all
  search?: string; // user/charger/chargePointId/rfid
  limit?: number;
}

export async function getActiveSessions(): Promise<ChargingSession[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(sessionSelect)
    .eq("status", "active")
    .order("start_time", { ascending: false });

  if (error) throw error;
  return mapSessionRows((data as Record<string, unknown>[]) ?? []);
}

export async function getSessionHistory(query: SessionsHistoryQuery = {}): Promise<ChargingSession[]> {
  const { status = "all", search = "", limit = 500 } = query;

  let q = requireSupabase()
    .from("EV_ChargingSessions")
    .select(sessionSelect)
    // history = everything except active
    .neq("status", "active")
    .order("start_time", { ascending: false })
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);

  const s = search.trim();
  if (s) {
    // Robust filters on base columns. (Joined-table text search varies by PostgREST config.)
    q = q.or(`id.ilike.%${s}%,transaction_id::text.ilike.%${s}%`);
  }

  const { data, error } = await q;

  if (error) throw error;
  return mapSessionRows((data as Record<string, unknown>[]) ?? []);
}

export async function getSessionById(id: string): Promise<ChargingSession | undefined> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(sessionSelect)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;
  const row = data as Record<string, unknown>;
  return mapSession(
    row,
    row.EV_Chargers as Record<string, unknown>,
    row.EV_Users as Record<string, unknown>,
    row.EV_RFIDCards as Record<string, unknown>
  );
}
