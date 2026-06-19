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

function bindErrorMessage(message: string): string {
  if (message.includes("already assigned")) {
    return "This RFID is already assigned to another user";
  }
  if (message.includes("blocked")) {
    return "Cannot bind a blocked RFID card";
  }
  if (message.includes("bind_ev_rfid_to_user")) {
    return "RFID binding rules not applied on server — contact admin";
  }
  return message;
}

async function bindCardToUser(cardId: string, userId: string): Promise<RFIDCard> {
  const { error: bindErr } = await requireSupabase().rpc("bind_ev_rfid_to_user", {
    p_card_id: cardId,
    p_user_id: userId,
  });
  if (bindErr) throw new Error(bindErrorMessage(bindErr.message));

  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .eq("id", cardId)
    .single();

  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
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
    return bindCardToUser(row.id as string, uidAuth);
  }

  const { data: created, error: insertErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .insert({
      uid: trimmed,
      status: "inactive",
      total_sessions: 0,
    })
    .select("*")
    .single();

  if (insertErr) throw insertErr;
  const createdRow = created as Record<string, unknown>;
  return bindCardToUser(createdRow.id as string, uidAuth);
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
