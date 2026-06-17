#!/usr/bin/env node
/**
 * Minimal OCPP 1.6J test charge point for local gateway development.
 * Usage: node scripts/ocpp-test-client.mjs MP-TEST-001
 */
import WebSocket from "ws";

const chargePointId = (process.argv[2] ?? "MP-TEST-001").toUpperCase();
const gatewayHost = process.env.OCPP_GATEWAY_WS ?? "ws://localhost:4040";
const url = `${gatewayHost}/ocpp/${chargePointId}`;

let msgId = 1;
const pending = new Map();

function sendCall(ws, action, payload) {
  const uniqueId = String(msgId++);
  const frame = JSON.stringify([2, uniqueId, action, payload]);
  ws.send(frame);
  return new Promise((resolve, reject) => {
    pending.set(uniqueId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(uniqueId)) {
        pending.delete(uniqueId);
        reject(new Error(`Timeout waiting for ${action}`));
      }
    }, 10000);
  });
}

function handleMessage(ws, raw) {
  const msg = JSON.parse(raw);
  const type = msg[0];
  const uniqueId = String(msg[1]);
  if (type === 3 && pending.has(uniqueId)) {
    pending.get(uniqueId).resolve(msg[2]);
    pending.delete(uniqueId);
    return;
  }
  if (type === 2) {
    const action = msg[2];
    const payload = msg[3] ?? {};
    console.log(`[test-cp] Incoming ${action}`, payload);
    if (action === "RemoteStartTransaction") {
      ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    } else if (action === "RemoteStopTransaction" || action === "Reset" || action === "UnlockConnector") {
      ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    } else if (action === "ChangeConfiguration" || action === "TriggerMessage") {
      ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    } else if (action === "UpdateFirmware") {
      ws.send(JSON.stringify([3, uniqueId, {}]));
      console.log("[test-cp] UpdateFirmware accepted", payload);
    } else {
      ws.send(JSON.stringify([3, uniqueId, {}]));
    }
  }
}

const ws = new WebSocket(url);

ws.on("open", async () => {
  console.log(`[test-cp] Connected as ${chargePointId}`);
  try {
    const boot = await sendCall(ws, "BootNotification", {
      chargePointVendor: "EV Simulator",
      chargePointModel: "TEST-60DC",
      firmwareVersion: "v1.0.0",
    });
    console.log("[test-cp] BootNotification.conf", boot);

    const hb = await sendCall(ws, "Heartbeat", {});
    console.log("[test-cp] Heartbeat.conf", hb);

    await sendCall(ws, "StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Available",
    });
    console.log("[test-cp] Ready — listening for remote commands");
  } catch (err) {
    console.error("[test-cp] Setup failed:", err.message);
  }
});

ws.on("message", (data) => handleMessage(ws, data.toString()));
ws.on("close", () => console.log("[test-cp] Disconnected"));
ws.on("error", (err) => console.error("[test-cp] Error:", err.message));
