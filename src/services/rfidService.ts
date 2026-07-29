import type { RFIDCard } from "@/types/ev";
import { requireSupabase } from "@/utils/supabaseClient";
import { mapRfid } from "@/utils/supabaseMappers";

/** OCPP idTag for web admin RemoteStart only. */
export const ADMIN_BYPASS_ID_TAG = "ADMIN-BYPASS";

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

/**
 * Ensure shared ADMIN-BYPASS RFID exists for OCPP RemoteStart.
 * Do not bind it to an admin user — multiple admins share this idTag; session
 * attribution uses the logged-in admin's user_id from RemoteStart (preferredUserId).
 */
export async function ensureAdminBypassAuthorizeTag(userId: string): Promise<string> {
  const tag = ADMIN_BYPASS_ID_TAG;
  const uid = userId.trim();
  if (!uid) {
    throw new Error("User session not found. Please login again.");
  }

  const { data: existing, error: findErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("id, status, user_id")
    .ilike("uid", tag)
    .maybeSingle();
  if (findErr) throw findErr;

  let cardId = (existing as { id: string } | null)?.id;
  if (!cardId) {
    const created = await createRfidCard(tag);
    cardId = created.id;
  } else {
    const row = existing as { status?: string; user_id?: string | null };
    if (String(row.status).toLowerCase() === "blocked") {
      await updateRfidStatus(cardId, "active");
    }
    // Self-heal legacy binds from older builds that bound ADMIN-BYPASS to one admin.
    if (row.user_id) {
      await unbindRfid(cardId);
    }
  }

  console.log("[auth] admin bypass tag ready", { tag, adminUserId: uid });
  return tag;
}
