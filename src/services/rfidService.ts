import type { RFIDCard } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapRfid } from "@/utils/supabaseMappers";

export async function getRfidCards(): Promise<RFIDCard[]> {
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*, EV_Users ( full_name )")
    .order("uid");

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
  const { error } = await requireSupabase()
    .from("EV_RFIDCards")
    .update({
      user_id: userId,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId);

  if (error) throw error;
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
