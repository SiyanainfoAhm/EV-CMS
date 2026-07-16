import { Router } from "express";
import { getConnection, isConnected, listConnections } from "../ocpp/connections.js";
import { sendOcppCall } from "../ocpp/caller.js";
import { config } from "../config.js";
import { ADMIN_BYPASS_ID_TAG, enableAdminRfidBypass } from "../ocpp/adminBypass.js";
import { isSupabaseConfigured } from "../supabase/client.js";
import * as repo from "../supabase/repository.js";
import * as alerts from "../supabase/alerts.js";

export const ocppRouter = Router();

function acceptedFromResponse(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const status = (response as Record<string, unknown>).status;
  return status === "Accepted";
}

function ocppWebSocketUrl(chargePointId: string): string {
  return `${config.ocppWsPath}/${encodeURIComponent(chargePointId.toUpperCase())}`;
}

/** Full fleet: every charger in DB + live OCPP socket status (unlimited count). */
ocppRouter.get("/fleet", async (_req, res) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    const chargers = await repo.listFleetChargers();
    const connectedIds = new Set(listConnections().map((c) => c.chargePointId.toUpperCase()));

    res.json({
      total: chargers.length,
      connectedCount: chargers.filter((c) => connectedIds.has(c.charge_point_id.toUpperCase())).length,
      ocppWsPathPattern: `${config.ocppWsPath}/{chargePointId}`,
      chargers: chargers.map((c) => {
        const cpId = c.charge_point_id.toUpperCase();
        return {
          id: c.id,
          chargePointId: cpId,
          name: c.name,
          chargerType: c.charger_type,
          status: c.status,
          location: c.location,
          manufacturer: c.manufacturer,
          isSimulated: c.is_simulated,
          ocppConnected: connectedIds.has(cpId),
          ocppWebSocketPath: ocppWebSocketUrl(cpId),
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Fleet lookup failed" });
  }
});

ocppRouter.get("/connected", (_req, res) => {
  res.json({
    count: listConnections().length,
    chargePoints: listConnections().map((c) => ({
      chargePointId: c.chargePointId,
      chargerDbId: c.chargerDbId,
      connectedAt: c.connectedAt,
      lastHeartbeatAt: c.lastHeartbeatAt,
    })),
  });
});

ocppRouter.post("/remote-start", async (req, res) => {
  try {
    const { chargePointId, connectorId, idTag, bypassRfid, prepaidPaid, paymentId, sessionId } =
      req.body as {
        chargePointId?: string;
        connectorId?: number;
        idTag?: string;
        bypassRfid?: boolean;
        /** True when user already paid prepaid and this Start must succeed or alert. */
        prepaidPaid?: boolean;
        paymentId?: string;
        sessionId?: string;
      };
    if (!chargePointId || !connectorId) {
      res.status(400).json({ accepted: false, error: "chargePointId, connectorId required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    const adminBypass = Boolean(bypassRfid) || config.bypassRfidAuth;

    let charger: repo.ChargerRow | null = null;
    if (isSupabaseConfigured()) {
      charger = await repo.findChargerByChargePointId(cpId);
      if (adminBypass && charger && !charger.allow_admin_bypass && !config.bypassRfidAuth) {
        res.status(403).json({
          accepted: false,
          error:
            "Lab admin bypass is disabled on this charger. Enable allow_admin_bypass for test Start without prepaid.",
        });
        return;
      }
    }

    if (adminBypass) {
      enableAdminRfidBypass(cpId);
    }
    const resolvedIdTag = adminBypass
      ? ADMIN_BYPASS_ID_TAG
      : idTag?.trim() || "";
    if (!resolvedIdTag) {
      res.status(400).json({ accepted: false, error: "idTag required" });
      return;
    }
    const response = await sendOcppCall(cpId, "RemoteStartTransaction", {
      connectorId: Number(connectorId),
      idTag: resolvedIdTag,
    });
    const accepted = acceptedFromResponse(response);
    if (isSupabaseConfigured()) {
      if (charger) {
        await repo.logEvent(charger.id, cpId, Number(connectorId), "RemoteStartTransaction", {
          idTag: resolvedIdTag,
          response,
          bypassRfid: adminBypass,
          prepaidPaid: Boolean(prepaidPaid),
          paymentId: paymentId ?? null,
          sessionId: sessionId ?? null,
        });
      }
      if (!accepted && prepaidPaid) {
        await alerts.notifyPrepaidStartFailed(
          cpId,
          `RemoteStart rejected after prepaid payment${paymentId ? ` (${paymentId})` : ""}${
            sessionId ? ` session=${sessionId}` : ""
          }: ${JSON.stringify(response)}`
        );
      }
    }
    res.json({ accepted, response, bypassRfid: adminBypass });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Remote start failed";
    const prepaidPaid = Boolean((req.body as { prepaidPaid?: boolean })?.prepaidPaid);
    const chargePointId = String((req.body as { chargePointId?: string })?.chargePointId ?? "").toUpperCase();
    if (prepaidPaid && chargePointId && isSupabaseConfigured()) {
      await alerts.notifyPrepaidStartFailed(chargePointId, message);
    }
    res.status(502).json({
      accepted: false,
      error: message,
    });
  }
});

ocppRouter.post("/remote-stop", async (req, res) => {
  try {
    const { chargePointId, transactionId, bypassRfid } = req.body as {
      chargePointId?: string;
      transactionId?: number;
      bypassRfid?: boolean;
    };
    if (!chargePointId || transactionId == null) {
      res.status(400).json({ accepted: false, error: "chargePointId, transactionId required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    if (bypassRfid || config.bypassRfidAuth) {
      enableAdminRfidBypass(cpId);
    }
    const response = await sendOcppCall(cpId, "RemoteStopTransaction", {
      transactionId: Number(transactionId),
    });
    const accepted = acceptedFromResponse(response);
    if (isSupabaseConfigured()) {
      const charger = await repo.findChargerByChargePointId(cpId);
      if (charger) {
        await repo.logEvent(charger.id, cpId, null, "RemoteStopTransaction", { transactionId, response });
      }
    }
    res.json({ accepted, response });
  } catch (err) {
    res.status(502).json({
      accepted: false,
      error: err instanceof Error ? err.message : "Remote stop failed",
    });
  }
});

ocppRouter.post("/reset", async (req, res) => {
  try {
    const { chargePointId, type } = req.body as { chargePointId?: string; type?: string };
    if (!chargePointId) {
      res.status(400).json({ accepted: false, error: "chargePointId required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    const resetType = type === "Hard" ? "Hard" : "Soft";
    const response = await sendOcppCall(cpId, "Reset", { type: resetType });
    res.json({ accepted: acceptedFromResponse(response), response });
  } catch (err) {
    res.status(502).json({
      accepted: false,
      error: err instanceof Error ? err.message : "Reset failed",
    });
  }
});

ocppRouter.post("/unlock", async (req, res) => {
  try {
    const { chargePointId, connectorId } = req.body as { chargePointId?: string; connectorId?: number };
    if (!chargePointId || !connectorId) {
      res.status(400).json({ accepted: false, error: "chargePointId, connectorId required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    const response = await sendOcppCall(cpId, "UnlockConnector", {
      connectorId: Number(connectorId),
    });
    res.json({ accepted: acceptedFromResponse(response), response });
  } catch (err) {
    res.status(502).json({
      accepted: false,
      error: err instanceof Error ? err.message : "Unlock failed",
    });
  }
});

ocppRouter.get("/chargers/:chargePointId/status", async (req, res) => {
  const cpId = req.params.chargePointId.toUpperCase();
  const connected = isConnected(cpId);
  const conn = getConnection(cpId);

  if (!isSupabaseConfigured()) {
    res.json({ chargePointId: cpId, connected, status: connected ? "online" : "offline" });
    return;
  }

  try {
    const charger = await repo.findChargerByChargePointId(cpId);
    res.json({
      chargePointId: cpId,
      connected,
      chargerDbId: charger?.id ?? conn?.chargerDbId ?? null,
      status: charger?.status ?? (connected ? "online" : "offline"),
      lastHeartbeatAt: conn?.lastHeartbeatAt ?? null,
      ocppWebSocketPath: ocppWebSocketUrl(cpId),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Status lookup failed" });
  }
});

ocppRouter.get("/chargers/:chargePointId/connectors/:connectorId", async (req, res) => {
  const cpId = req.params.chargePointId.toUpperCase();
  const connectorId = Number(req.params.connectorId);

  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Supabase not configured" });
    return;
  }

  try {
    const charger = await repo.findChargerByChargePointId(cpId);
    if (!charger) {
      res.status(404).json({ error: "Charger not found" });
      return;
    }
    const connector = await repo.getConnectorStatus(charger.id, connectorId);
    res.json({
      chargePointId: cpId,
      connectorId,
      connected: isConnected(cpId),
      ...(connector ?? { status: "Unknown" }),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Connector lookup failed" });
  }
});

ocppRouter.post("/change-configuration", async (req, res) => {
  try {
    const { chargePointId, key, value } = req.body as {
      chargePointId?: string;
      key?: string;
      value?: string;
    };
    if (!chargePointId || !key) {
      res.status(400).json({ accepted: false, error: "chargePointId and key required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    const response = await sendOcppCall(cpId, "ChangeConfiguration", {
      key: String(key),
      value: String(value ?? ""),
    });
    res.json({ accepted: acceptedFromResponse(response), response });
  } catch (err) {
    res.status(502).json({
      accepted: false,
      error: err instanceof Error ? err.message : "ChangeConfiguration failed",
    });
  }
});

ocppRouter.post("/trigger-meter-values", async (req, res) => {
  try {
    const { chargePointId, connectorId } = req.body as { chargePointId?: string; connectorId?: number };
    if (!chargePointId) {
      res.status(400).json({ accepted: false, error: "chargePointId required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    const requestedMessage = connectorId
      ? { requestedMessage: "MeterValues", connectorId: Number(connectorId) }
      : { requestedMessage: "MeterValues" };
    const response = await sendOcppCall(cpId, "TriggerMessage", requestedMessage);
    res.json({ accepted: acceptedFromResponse(response), response });
  } catch (err) {
    res.status(502).json({
      accepted: false,
      error: err instanceof Error ? err.message : "TriggerMessage failed",
    });
  }
});

ocppRouter.post("/update-firmware", async (req, res) => {
  try {
    const { chargePointId, location, retrieveDate } = req.body as {
      chargePointId?: string;
      location?: string;
      retrieveDate?: string;
    };
    if (!chargePointId || !location) {
      res.status(400).json({ accepted: false, error: "chargePointId and location required" });
      return;
    }
    const cpId = String(chargePointId).toUpperCase();
    const response = await sendOcppCall(cpId, "UpdateFirmware", {
      location: String(location),
      retrieveDate: retrieveDate ?? new Date().toISOString(),
    });
    const accepted = acceptedFromResponse(response);
    void alerts.notifyFirmwareAlert(
      cpId,
      accepted ? "sent" : "failed",
      accepted ? `Package URL: ${String(location)}` : "Charger rejected UpdateFirmware"
    );
    res.json({ accepted, response });
  } catch (err) {
    const cpId = String((req.body as { chargePointId?: string }).chargePointId ?? "").toUpperCase();
    if (cpId) {
      void alerts.notifyFirmwareAlert(
        cpId,
        "failed",
        err instanceof Error ? err.message : "UpdateFirmware failed"
      );
    }
    res.status(502).json({
      accepted: false,
      error: err instanceof Error ? err.message : "UpdateFirmware failed",
    });
  }
});
