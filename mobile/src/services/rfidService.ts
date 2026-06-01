import { requireSupabase } from "../utils/supabaseClient";
import type { RFIDCard } from "../types";

export async function getUserRfidCards(): Promise<RFIDCard[]> {
  const { data, error } = await requireSupabase().from("EV_RFIDCards").select("*").order("uid");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    uid: row.uid as string,
    status: row.status as string,
  }));
}

export async function bindRfid(uid: string): Promise<RFIDCard> {
  return { id: "new", uid, status: "active" };
}
