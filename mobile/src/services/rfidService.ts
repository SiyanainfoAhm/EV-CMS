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

/**
 * Ensure ADMIN-BYPASS is an active RFID bound to this user.
 * Physical chargers Authorize the idTag from RemoteStart; without a DB card
 * (and without Fly in-memory bypass), Authorize is Invalid → session never starts
 * or ends in a few seconds ("Waiting for authentication").
 */
export async function ensureAdminBypassAuthorizeTag(userId?: string): Promise<string> {
  const uid = userId ?? requireUserId();
  const TAG = "ADMIN-BYPASS";

  const { data: existing, error: findErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .ilike("uid", TAG)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const row = existing as Record<string, unknown>;
    const { error } = await requireSupabase()
      .from("EV_RFIDCards")
      .update({
        uid: TAG,
        user_id: uid,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id as string);
    if (error) {
      // Fallback via bind RPC if direct update blocked.
      try {
        await bindCardToUser(row.id as string, uid);
        await requireSupabase()
          .from("EV_RFIDCards")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("id", row.id as string);
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? e.message
            : "Unable to prepare charger authorization tag"
        );
      }
    }
    return TAG;
  }

  const { data: created, error: insertErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .insert({
      uid: TAG,
      user_id: uid,
      status: "active",
      total_sessions: 0,
    })
    .select("*")
    .single();

  if (insertErr) {
    // Race: another client created it — bind to this user.
    const { data: raced } = await requireSupabase()
      .from("EV_RFIDCards")
      .select("*")
      .ilike("uid", TAG)
      .maybeSingle();
    if (raced) {
      await requireSupabase()
        .from("EV_RFIDCards")
        .update({
          user_id: uid,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", (raced as { id: string }).id);
      return TAG;
    }
    throw new Error(insertErr.message || "Unable to create ADMIN-BYPASS RFID");
  }

  void created;
  return TAG;
}

/**
 * Ensure the user has an active idTag for OCPP Authorize / RemoteStart.
 * Creates a mobile virtual RFID when none is bound — avoids lab admin bypass.
 */
export async function ensureActiveIdTag(userId?: string): Promise<string> {
  const uid = userId ?? requireUserId();
  const cards = await getUserRfidCards(uid);
  const active = cards.find((c) => String(c.status).toLowerCase() === "active" && c.uid?.trim());
  if (active?.uid?.trim() && !active.uid.startsWith("MOBILE-") && active.uid !== "ADMIN-BYPASS") {
    return active.uid.trim();
  }
  if (active?.uid?.trim() && !active.uid.startsWith("MOBILE-")) {
    return active.uid.trim();
  }

  // Re-activate an inactive card already owned by this user (real RFID preferred).
  const owned = cards.find(
    (c) =>
      c.uid?.trim() &&
      !c.uid.startsWith("MOBILE-") &&
      c.uid !== "ADMIN-BYPASS" &&
      String(c.status).toLowerCase() !== "blocked"
  );
  if (owned) {
    const { error } = await requireSupabase()
      .from("EV_RFIDCards")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", owned.id)
      .eq("user_id", uid);
    if (!error) return owned.uid.trim();
  }

  const tag = `MOBILE-${uid.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const { data: existing } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .eq("uid", tag)
    .maybeSingle();

  if (existing) {
    const card = await bindCardToUser((existing as { id: string }).id, uid);
    return card.uid;
  }

  const { data: created, error: insertErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .insert({
      uid: tag,
      status: "inactive",
      total_sessions: 0,
    })
    .select("*")
    .single();
  if (insertErr) throw new Error(insertErr.message || "Unable to create mobile RFID tag");

  const card = await bindCardToUser((created as { id: string }).id, uid);
  return card.uid;
}
