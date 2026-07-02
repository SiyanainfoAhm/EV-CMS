import { requireSupabase } from "../utils/supabaseClient";
import { requireUserId } from "./authService";
import * as rfidService from "./rfidService";
import * as sessionService from "./sessionService";
import type { ChargingSession } from "../types";

async function assertUserCanCharge(userId: string): Promise<void> {
  const { data, error } = await requireSupabase().rpc("get_ev_user_profile", {
    p_user_id: userId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || (row as { status: string }).status !== "active") {
    throw new Error("USER_INACTIVE");
  }
}

async function assertRfidOrMobileAuth(userId: string): Promise<void> {
  const cards = await rfidService.getUserRfidCards(userId);
  const hasActive = cards.some((c) => c.status === "active");
  if (!hasActive) {
    // Mobile authorization path — allow demo users without RFID
    return;
  }
}

async function assertPaymentReadiness(_userId: string): Promise<void> {
  // Direct post-session payment — no prepaid wallet balance required.
}

export async function startCharging(
  chargerId: string,
  connectorId: number,
  userId?: string
): Promise<ChargingSession> {
  const uid = userId ?? requireUserId();
  await assertUserCanCharge(uid);
  await assertRfidOrMobileAuth(uid);
  await assertPaymentReadiness(uid);
  return sessionService.startSession(chargerId, connectorId, uid);
}

export async function stopCharging(
  sessionId: string,
  userId?: string
): Promise<ChargingSession | null> {
  const uid = userId ?? requireUserId();
  await sessionService.stopSession(sessionId, uid);
  return sessionService.getSessionById(sessionId, uid);
}

export async function getActiveSession(userId?: string): Promise<ChargingSession | null> {
  return sessionService.getActiveSession(userId);
}

export function subscribeActiveSession(
  onUpdate: () => void
): () => void {
  const channel = requireSupabase()
    .channel("mobile-active-session")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "EV_ChargingSessions" },
      () => onUpdate()
    )
    .subscribe();

  return () => {
    requireSupabase().removeChannel(channel);
  };
}
