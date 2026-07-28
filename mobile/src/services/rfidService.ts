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

function isDuplicateKeyError(message: string): boolean {
  return /duplicate key|unique constraint|idx_ev_rfid_cards_one_user/i.test(message);
}

function bindErrorMessage(message: string): string {
  if (isDuplicateKeyError(message)) {
    return "An RFID card is already assigned to this user. Updating existing card instead.";
  }
  if (/already assigned to another user|already assigned/i.test(message)) {
    return "This RFID card is already assigned to another user.";
  }
  if (message.includes("blocked")) {
    return "Cannot bind a blocked RFID card";
  }
  if (message.includes("bind_ev_rfid_to_user")) {
    return "RFID binding rules not applied on server — contact admin";
  }
  return message;
}

/** Trim and uppercase RFID UID for consistent storage and lookup. */
export function normalizeRfidUid(uid: string): string {
  return uid.trim().toUpperCase();
}

/** Validate RFID UID is non-empty after normalization. */
export function validateRfidUid(uid: string): string {
  const normalized = normalizeRfidUid(uid);
  if (!normalized) {
    throw new Error("RFID card UID is required");
  }
  return normalized;
}

async function fetchCardById(cardId: string): Promise<RFIDCard> {
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

async function getUserRfidCard(userId: string): Promise<RFIDCard | null> {
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

async function findCardByUid(cardUid: string): Promise<RFIDCard | null> {
  const normalized = normalizeRfidUid(cardUid);
  const { data, error } = await requireSupabase()
    .from("EV_RFIDCards")
    .select("*")
    .ilike("uid", normalized)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

async function activateCard(cardId: string): Promise<RFIDCard> {
  const { error } = await requireSupabase()
    .from("EV_RFIDCards")
    .update({
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", cardId);
  if (error) throw new Error(bindErrorMessage(error.message));
  return fetchCardById(cardId);
}

async function bindCardToUser(cardId: string, userId: string): Promise<RFIDCard> {
  const { error: bindErr } = await requireSupabase().rpc("bind_ev_rfid_to_user", {
    p_card_id: cardId,
    p_user_id: userId,
  });
  if (bindErr) throw new Error(bindErrorMessage(bindErr.message));
  return fetchCardById(cardId);
}

/**
 * Assign or update one RFID card for a user (respects idx_ev_rfid_cards_one_user).
 * - Updates existing user card when present (no blind insert).
 * - Blocks UID already owned by another user.
 */
export async function assignOrUpdateRfidCard(
  userId: string,
  cardUid: string
): Promise<RFIDCard> {
  const normalized = validateRfidUid(cardUid);

  const [userCard, uidCard] = await Promise.all([
    getUserRfidCard(userId),
    findCardByUid(normalized),
  ]);

  if (uidCard?.userId && uidCard.userId !== userId) {
    throw new Error("This RFID card is already assigned to another user.");
  }

  // User already has a card — update in place or re-bind existing UID row.
  if (userCard) {
    if (normalizeRfidUid(userCard.uid) === normalized) {
      return activateCard(userCard.id);
    }

    if (uidCard && uidCard.id !== userCard.id) {
      // UID exists on a different unassigned row — bind it (RPC unbinds user's old card).
      return bindCardToUser(uidCard.id, userId);
    }

    const { error: updErr } = await requireSupabase()
      .from("EV_RFIDCards")
      .update({
        uid: normalized,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", userCard.id)
      .eq("user_id", userId);

    if (updErr) {
      if (isDuplicateKeyError(updErr.message)) {
        const retry = await getUserRfidCard(userId);
        if (retry && normalizeRfidUid(retry.uid) === normalized) {
          return activateCard(retry.id);
        }
        throw new Error(
          "An RFID card is already assigned to this user. Updating existing card instead."
        );
      }
      throw new Error(bindErrorMessage(updErr.message));
    }

    return fetchCardById(userCard.id);
  }

  // No card for this user yet.
  if (uidCard) {
    return bindCardToUser(uidCard.id, userId);
  }

  const { data: created, error: insertErr } = await requireSupabase()
    .from("EV_RFIDCards")
    .insert({
      uid: normalized,
      status: "inactive",
      total_sessions: 0,
    })
    .select("*")
    .single();

  if (insertErr) {
    if (isDuplicateKeyError(insertErr.message)) {
      const raced = await findCardByUid(normalized);
      if (raced) {
        if (raced.userId && raced.userId !== userId) {
          throw new Error("This RFID card is already assigned to another user.");
        }
        return bindCardToUser(raced.id, userId);
      }
      const existingUserCard = await getUserRfidCard(userId);
      if (existingUserCard) {
        return assignOrUpdateRfidCard(userId, normalized);
      }
      throw new Error(
        "An RFID card is already assigned to this user. Updating existing card instead."
      );
    }
    throw new Error(bindErrorMessage(insertErr.message));
  }

  return bindCardToUser((created as { id: string }).id, userId);
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

/** Bind a physical RFID UID to the current (or given) user. */
export async function bindRfid(uid: string, userId?: string): Promise<RFIDCard> {
  const uidAuth = userId ?? requireUserId();
  return assignOrUpdateRfidCard(uidAuth, uid);
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
 * Ensure MOBILE-{userId} idTag for OCPP RemoteStart.
 * Does not write EV_RFIDCards (one-card-per-user) — gateway Authorize accepts MOBILE-* via EV_Users.
 */
export async function ensureMobileAuthorizeTag(userId?: string): Promise<string> {
  const uid = userId ?? requireUserId();
  if (!uid?.trim()) {
    throw new Error("User session not found. Please login again.");
  }
  const tag = `MOBILE-${uid}`;
  console.log("[auth] mobile authorize tag", tag);
  return tag;
}

/**
 * @deprecated Use ensureMobileAuthorizeTag — ADMIN-BYPASS is removed.
 */
export async function ensureAdminBypassAuthorizeTag(userId?: string): Promise<string> {
  return ensureMobileAuthorizeTag(userId);
}

/**
 * Ensure the user has an active idTag for OCPP Authorize / RemoteStart.
 * Prefers a physical RFID card; otherwise returns MOBILE-{userId}.
 */
export async function ensureActiveIdTag(userId?: string): Promise<string> {
  const uid = userId ?? requireUserId();
  const cards = await getUserRfidCards(uid);

  const activeReal = cards.find(
    (c) =>
      c.uid?.trim() &&
      !c.uid.toUpperCase().startsWith("MOBILE-") &&
      c.uid.toUpperCase() !== "ADMIN-BYPASS" &&
      String(c.status).toLowerCase() === "active"
  );
  if (activeReal?.uid?.trim()) {
    return normalizeRfidUid(activeReal.uid);
  }

  const ownedReal = cards.find(
    (c) =>
      c.uid?.trim() &&
      !c.uid.toUpperCase().startsWith("MOBILE-") &&
      c.uid.toUpperCase() !== "ADMIN-BYPASS" &&
      String(c.status).toLowerCase() !== "blocked"
  );
  if (ownedReal) {
    const card = await activateCard(ownedReal.id);
    return normalizeRfidUid(card.uid);
  }

  return ensureMobileAuthorizeTag(uid);
}
