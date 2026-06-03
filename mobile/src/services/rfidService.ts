import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import type { RFIDCard } from "../types";

function mapRow(row: Record<string, unknown>): RFIDCard {
  return {
    id: row.id as string,
    uid: row.uid as string,
    status: row.status as string,
    userId: row.user_id as string | null | undefined,
  };
}

export async function getUserRfidCards(userId?: string): Promise<RFIDCard[]> {
  const uid = userId ?? requireUserId();
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .eq("user_id", uid)
    .order("uid");

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function bindRfid(uid: string, userId?: string): Promise<RFIDCard> {
  const trimmed = uid.trim();
  if (!trimmed) throw new Error("Enter RFID UID");

  const uidAuth = userId ?? requireUserId();

  const { data: existing, error: findErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .eq("uid", trimmed)
    .maybeSingle();

  if (findErr) throw findErr;

  if (existing) {
    const row = existing as Record<string, unknown>;
    if (row.user_id && row.user_id !== uidAuth) {
      throw new Error("This RFID is already bound to another user");
    }
    const { data: updated, error: updateErr } = await requireSupabase()
      .from("EV_RFIDCards")
      .update({ user_id: uidAuth, status: "active", updated_at: new Date().toISOString() })
      .eq("id", row.id as string)
      .select("*")
      .single();

    if (updateErr) throw updateErr;
    return mapRow(updated as Record<string, unknown>);
  }

  const { data: created, error: insertErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .insert({
      uid: trimmed,
      user_id: uidAuth,
      status: "active",
      total_sessions: 0,
    })
    .select("*")
    .single();

  if (insertErr) throw insertErr;
  return mapRow(created as Record<string, unknown>);
}

export async function unbindRfid(cardId: string, userId?: string): Promise<void> {
  const uid = userId ?? requireUserId();
  const { error } = await requireSupabase()
    .from("EV_RFIDCards")
    .update({
      user_id: null,
      status: "inactive",
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId)
    .eq("user_id", uid);

  if (error) throw error;
}
