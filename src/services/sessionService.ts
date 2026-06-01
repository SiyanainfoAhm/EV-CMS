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

export async function getActiveSessions(): Promise<ChargingSession[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(sessionSelect)
    .eq("status", "active")
    .order("start_time", { ascending: false });

  if (error) throw error;
  return mapSessionRows((data as Record<string, unknown>[]) ?? []);
}

export async function getSessionHistory(): Promise<ChargingSession[]> {
  const { data, error } = await requireSupabase()
    .from("EV_ChargingSessions")
    .select(sessionSelect)
    .eq("status", "completed")
    .order("start_time", { ascending: false });

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
