import type { RFIDCard } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapRfid } from "@/utils/supabaseMappers";

export interface RfidQuery {
  status?: string; // active | inactive | blocked | all
  search?: string; // uid / bound user name
  limit?: number;
}

export async function getRfidCards(query: RfidQuery = {}): Promise<RFIDCard[]> {
  const { status = "all", search = "", limit = 500 } = query;

  let q = requireSupabase()
    .from("EV_RFIDCards")
    .select("*, EV_Users!left ( full_name )")
    .order("uid")
    .limit(limit);

  if (status !== "all") q = q.eq("status", status);

  const s = search.trim();
  if (s) {
    q = q.ilike("uid", `%${s}%`);
  }

  const { data, error } = await q;

  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return mapRfid(r, r.EV_Users as Record<string, unknown> | null);
  });
}

export async function getRfidCardById(id: string): Promise<RFIDCard | undefined> {
  const cards = await getRfidCards();
  return cards.find((c) => c.id === id);
}

export async function createRfidCard(uid: string): Promise<RFIDCard> {
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .insert({
      uid: uid.trim(),
      status: "active",
      total_sessions: 0,
    })
    .select("*, EV_Users ( full_name )")
    .single();

  if (error) throw error;
  const r = data as Record<string, unknown>;
  return mapRfid(r, r.EV_Users as Record<string, unknown> | null);
}

export async function updateRfidStatus(id: string, status: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_RFIDCards")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function bindRfidToUser(cardId: string, userId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("bind_ev_rfid_to_user", {
    p_card_id: cardId,
    p_user_id: userId,
  });

  if (error) {
    const msg = error.message ?? "Failed to bind card";
    if (msg.includes("already assigned")) {
      throw new Error("This RFID is already assigned to another user");
    }
    if (msg.includes("blocked")) {
      throw new Error("Cannot bind a blocked RFID card");
    }
    if (msg.includes("bind_ev_rfid_to_user")) {
      throw new Error("Run supabase/rfid_one_per_user.sql on Supabase to enable RFID binding rules");
    }
    throw new Error(msg);
  }
}

export async function unbindRfid(cardId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("EV_RFIDCards")
    .update({
      user_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId);

  if (error) throw error;
}
