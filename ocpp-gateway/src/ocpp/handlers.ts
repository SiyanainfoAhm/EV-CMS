import type { ChargePointConnection } from "./connections.js";
import { setChargerDbId } from "./connections.js";
import { buildCallResult, buildCallError, parseMessage } from "./protocol.js";
import { resolveResponse, rejectResponse } from "./pending.js";
import { sendOcppCallFireAndForget } from "./caller.js";
import { config } from "../config.js";
import { isSupabaseConfigured } from "../supabase/client.js";
import * as repo from "../supabase/repository.js";
import * as alerts from "../supabase/alerts.js";

function ocppNow(): string {
  return new Date().toISOString();
}

function sendResult(conn: ChargePointConnection, uniqueId: string, payload: Record<string, unknown>): void {
  conn.ws.send(buildCallResult(uniqueId, payload));
}

function sendError(conn: ChargePointConnection, uniqueId: string, description: string): void {
  conn.ws.send(buildCallError(uniqueId, "InternalError", description));
}

async function handleCall(
  conn: ChargePointConnection,
  uniqueId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!isSupabaseConfigured()) {
    sendError(conn, uniqueId, "Supabase not configured on gateway");
    return;
  }

  try {
    switch (action) {
      case "BootNotification": {
        const charger = await repo.recordBootNotification(conn.chargePointId, payload);
        if (charger) {
          setChargerDbId(conn.chargePointId, charger.id);
          conn.chargerDbId = charger.id;
        }
        const interval = config.heartbeatIntervalSec;
        conn.heartbeatIntervalSec = interval;
        sendResult(conn, uniqueId, {
          status: charger ? "Accepted" : "Rejected",
          currentTime: ocppNow(),
          interval,
        });
        break;
      }

      case "Heartbeat": {
        if (conn.chargerDbId) {
          await repo.recordHeartbeat(conn.chargerDbId, conn.chargePointId);
          conn.lastHeartbeatAt = new Date();
        }
        sendResult(conn, uniqueId, { currentTime: ocppNow() });
        break;
      }

      case "StatusNotification": {
        const connectorId = Number(payload.connectorId ?? 0);
        const status = String(payload.status ?? "Unavailable");
        if (conn.chargerDbId) {
          await repo.recordStatusNotification(conn.chargerDbId, conn.chargePointId, connectorId, status, payload);
        }
        sendResult(conn, uniqueId, {});
        break;
      }

      case "Authorize": {
        const idTag = String(payload.idTag ?? "");
        const authStatus = await repo.authorizeIdTag(idTag, conn.chargePointId);
        if (conn.chargerDbId) {
          await repo.logEvent(conn.chargerDbId, conn.chargePointId, null, "Authorize", { idTag, status: authStatus });
        }
        sendResult(conn, uniqueId, { idTagInfo: { status: authStatus } });
        break;
      }

      case "StartTransaction": {
        if (!conn.chargerDbId) {
          sendResult(conn, uniqueId, { idTagInfo: { status: "Invalid" } });
          break;
        }
        const charger = await repo.findChargerByChargePointId(conn.chargePointId);
        if (!charger) {
          sendResult(conn, uniqueId, { idTagInfo: { status: "Invalid" } });
          break;
        }
        const idTag = String(payload.idTag ?? "");
        const authStatus = await repo.authorizeIdTag(idTag, conn.chargePointId);
        if (authStatus !== "Accepted") {
          sendResult(conn, uniqueId, { idTagInfo: { status: authStatus } });
          break;
        }
        const transactionId = await repo.startTransaction({
          chargerId: conn.chargerDbId,
          chargePointId: conn.chargePointId,
          connectorId: Number(payload.connectorId ?? 1),
          idTag,
          meterStart: Number(payload.meterStart ?? 0),
          timestamp: String(payload.timestamp ?? ocppNow()),
          chargerType: charger.charger_type,
        });
        sendResult(conn, uniqueId, {
          transactionId,
          idTagInfo: { status: "Accepted" },
        });
        break;
      }

      case "StopTransaction": {
        const transactionId = Number(payload.transactionId);
        await repo.stopTransaction({
          transactionId,
          meterStop: Number(payload.meterStop ?? 0),
          timestamp: String(payload.timestamp ?? ocppNow()),
          reason: payload.reason != null ? String(payload.reason) : undefined,
        });
        sendResult(conn, uniqueId, { idTagInfo: { status: "Accepted" } });
        break;
      }

      case "MeterValues": {
        if (!conn.chargerDbId) {
          sendResult(conn, uniqueId, {});
          break;
        }
        const transactionId = Number(payload.transactionId ?? 0);
        const connectorId = Number(payload.connectorId ?? 1);
        const parsed = repo.parseMeterSampledValues(payload.meterValue);
        if (transactionId > 0) {
          const autoStop = await repo.recordMeterValues({
            transactionId,
            chargerId: conn.chargerDbId,
            chargePointId: conn.chargePointId,
            connectorId,
            sampledAt: parsed.sampledAt,
            energyKwh: parsed.energyKwh,
            energyRegisterKwh: parsed.energyRegisterKwh,
            powerKw: parsed.powerKw,
            soc: parsed.soc,
            rawSamples: parsed.rawSamples,
          });
          if (autoStop?.shouldRemoteStop) {
            try {
              sendOcppCallFireAndForget(conn.chargePointId, "RemoteStopTransaction", {
                transactionId: autoStop.transactionId,
              });
              console.log(
                `[ocpp] Prepaid auto-stop ${autoStop.reason} tx=${autoStop.transactionId} on ${conn.chargePointId}`
              );
            } catch (err) {
              console.warn("[ocpp] Prepaid auto-stop failed:", err);
            }
          }
        }
        sendResult(conn, uniqueId, {});
        break;
      }

      case "FirmwareStatusNotification": {
        const status = String(payload.status ?? "Unknown");
        if (conn.chargerDbId) {
          await repo.logEvent(conn.chargerDbId, conn.chargePointId, null, "FirmwareStatusNotification", {
            status,
            ...payload,
          });
        }
        if (status === "Installed") {
          void alerts.notifyFirmwareAlert(conn.chargePointId, "installed", `Firmware status: ${status}`);
        } else if (status === "DownloadFailed" || status === "InstallationFailed") {
          void alerts.notifyFirmwareAlert(conn.chargePointId, "failed", `Firmware status: ${status}`);
        }
        sendResult(conn, uniqueId, {});
        break;
      }

      default:
        console.warn(`[ocpp] Unsupported action from CP ${conn.chargePointId}: ${action}`);
        sendResult(conn, uniqueId, {});
    }
  } catch (err) {
    console.error(`[ocpp] Handler error ${action} (${conn.chargePointId}):`, err);
    sendError(conn, uniqueId, err instanceof Error ? err.message : "Handler failed");
  }
}

export async function handleInboundMessage(conn: ChargePointConnection, raw: string): Promise<void> {
  let parsed;
  try {
    parsed = parseMessage(raw);
  } catch {
    console.warn(`[ocpp] Invalid message from ${conn.chargePointId}:`, raw.slice(0, 200));
    return;
  }

  if (parsed.kind === "callResult") {
    resolveResponse(parsed.uniqueId, parsed.payload);
    return;
  }

  if (parsed.kind === "callError") {
    rejectResponse(parsed.uniqueId, new Error(`${parsed.code}: ${parsed.description}`));
    return;
  }

  if (parsed.kind === "call") {
    await handleCall(conn, parsed.uniqueId, parsed.action, parsed.payload);
  }
}
