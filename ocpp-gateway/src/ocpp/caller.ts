import type WebSocket from "ws";
import { getConnection } from "./connections.js";
import { buildCall, newUniqueId } from "./protocol.js";
import { waitForResponse, rejectResponse } from "./pending.js";
import { config } from "../config.js";

export async function sendOcppCall<T extends Record<string, unknown>>(
  chargePointId: string,
  action: string,
  payload: T
): Promise<unknown> {
  const conn = getConnection(chargePointId);
  if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
    throw new Error(`Charge point "${chargePointId}" is not connected`);
  }

  const uniqueId = newUniqueId();
  const message = buildCall(uniqueId, action, payload);

  const responsePromise = waitForResponse(uniqueId, config.ocppCallTimeoutMs);

  conn.ws.send(message, (err) => {
    if (err) {
      rejectResponse(uniqueId, err instanceof Error ? err : new Error(String(err)));
    }
  });

  return responsePromise;
}

export function sendOcppCallFireAndForget(
  chargePointId: string,
  action: string,
  payload: Record<string, unknown>
): void {
  const conn = getConnection(chargePointId);
  if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
    throw new Error(`Charge point "${chargePointId}" is not connected`);
  }
  conn.ws.send(buildCall(newUniqueId(), action, payload));
}
