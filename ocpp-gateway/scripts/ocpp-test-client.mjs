#!/usr/bin/env node
/**
 * OCPP 1.6J test charge point — full remote start/stop flow for CMS testing.
 *
 * Usage:
 *   node scripts/ocpp-test-client.mjs MP-TEST-001
 *   OCPP_GATEWAY_WS=wss://ev-cms-ocpp-dfccil.fly.dev node scripts/ocpp-test-client.mjs MP-TEST-001
 */
import WebSocket from "ws";

const chargePointId = (process.argv[2] ?? "MP-TEST-001").toUpperCase();
const gatewayHost = process.env.OCPP_GATEWAY_WS ?? "ws://localhost:4040";
const url = `${gatewayHost}/ocpp/${chargePointId}`;
const METER_INTERVAL_MS = Number(process.env.OCPP_TEST_METER_MS ?? 15000);

let msgId = 1;
const pending = new Map();

/** @type {WebSocket | null} */
let ws = null;
let activeTransactionId = null;
let activeConnectorId = null;
let activeIdTag = "RFID-DFCCIL-001";
let meterWh = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let meterTimer = null;

function ocppNow() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendCall(action, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("WebSocket not open"));
  }
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
    }, 15000);
  });
}

function sendCallFireAndForget(action, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const uniqueId = String(msgId++);
  ws.send(JSON.stringify([2, uniqueId, action, payload]));
}

function stopMeterLoop() {
  if (meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
}

function startMeterLoop() {
  stopMeterLoop();
  meterTimer = setInterval(() => {
    if (!activeTransactionId || activeConnectorId == null) return;
    meterWh += 350;
    const powerW = 7000 + Math.floor(Math.random() * 2000);
    sendCallFireAndForget("MeterValues", {
      connectorId: activeConnectorId,
      transactionId: activeTransactionId,
      meterValue: [
        {
          timestamp: ocppNow(),
          sampledValue: [
            {
              value: String(meterWh),
              unit: "Wh",
              measurand: "Energy.Active.Import.Register",
            },
            {
              value: String(powerW),
              unit: "W",
              measurand: "Power.Active.Import",
            },
            {
              value: String(Math.min(99, 20 + Math.floor(meterWh / 500))),
              unit: "Percent",
              measurand: "SoC",
            },
          ],
        },
      ],
    });
    console.log(`[test-cp] MeterValues tx=${activeTransactionId} energy=${(meterWh / 1000).toFixed(2)} kWh`);
  }, METER_INTERVAL_MS);
}

async function sendStatus(connectorId, status) {
  await sendCall("StatusNotification", {
    connectorId,
    errorCode: "NoError",
    status,
    timestamp: ocppNow(),
  });
  console.log(`[test-cp] StatusNotification connector ${connectorId} → ${status}`);
}

async function beginChargingSession(connectorId, idTag) {
  activeConnectorId = connectorId;
  activeIdTag = idTag;
  meterWh = 0;

  await sendStatus(connectorId, "Preparing");
  await sleep(400);

  const startResult = await sendCall("StartTransaction", {
    connectorId,
    idTag,
    meterStart: 0,
    timestamp: ocppNow(),
  });
  console.log("[test-cp] StartTransaction.conf", startResult);

  const txId = Number(startResult?.transactionId);
  if (!txId || Number.isNaN(txId)) {
    throw new Error("StartTransaction did not return transactionId — is MOBILE-{userId} / RFID OK in CMS?");
  }
  activeTransactionId = txId;

  await sendStatus(connectorId, "Charging");
  await sendCall("MeterValues", {
    connectorId,
    transactionId: activeTransactionId,
    meterValue: [
      {
        timestamp: ocppNow(),
        sampledValue: [
          { value: "100", unit: "Wh", measurand: "Energy.Active.Import.Register" },
          { value: "6500", unit: "W", measurand: "Power.Active.Import" },
        ],
      },
    ],
  });
  meterWh = 100;
  startMeterLoop();
  console.log(`[test-cp] Charging session active (transactionId=${activeTransactionId})`);
}

async function endChargingSession(reason = "Remote") {
  if (!activeTransactionId || activeConnectorId == null) {
    console.log("[test-cp] No active session to stop");
    return;
  }
  stopMeterLoop();
  const txId = activeTransactionId;
  const connectorId = activeConnectorId;
  meterWh += 200;

  await sendCall("StopTransaction", {
    transactionId: txId,
    meterStop: meterWh,
    timestamp: ocppNow(),
    reason,
    idTag: activeIdTag,
  });
  console.log(`[test-cp] StopTransaction tx=${txId}`);

  await sendStatus(connectorId, "Finishing");
  await sleep(400);
  await sendStatus(connectorId, "Available");

  activeTransactionId = null;
  activeConnectorId = null;
  console.log("[test-cp] Session ended — gun Available");
}

async function handleIncomingCall(uniqueId, action, payload) {
  console.log(`[test-cp] Incoming ${action}`, payload);

  if (action === "RemoteStartTransaction") {
    ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    const connectorId = Number(payload.connectorId ?? 1);
    const idTag = String(payload.idTag ?? "RFID-DFCCIL-001");
    try {
      await sleep(300);
      await beginChargingSession(connectorId, idTag);
    } catch (err) {
      console.error("[test-cp] Remote start flow failed:", err.message);
      await sendStatus(connectorId, "Available").catch(() => undefined);
    }
    return;
  }

  if (action === "RemoteStopTransaction") {
    ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    stopMeterLoop();
    try {
      await sleep(300);
      await endChargingSession("Remote");
    } catch (err) {
      console.error("[test-cp] Remote stop flow failed:", err.message);
    }
    return;
  }

  if (action === "Reset" || action === "UnlockConnector") {
    ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    return;
  }

  if (action === "ChangeConfiguration" || action === "TriggerMessage") {
    ws.send(JSON.stringify([3, uniqueId, { status: "Accepted" }]));
    if (action === "TriggerMessage" && payload.requestedMessage === "MeterValues" && activeTransactionId) {
      meterWh += 150;
      sendCallFireAndForget("MeterValues", {
        connectorId: activeConnectorId ?? 1,
        transactionId: activeTransactionId,
        meterValue: [
          {
            timestamp: ocppNow(),
            sampledValue: [
              { value: String(meterWh), unit: "Wh", measurand: "Energy.Active.Import.Register" },
              { value: "8000", unit: "W", measurand: "Power.Active.Import" },
            ],
          },
        ],
      });
    }
    return;
  }

  if (action === "UpdateFirmware") {
    ws.send(JSON.stringify([3, uniqueId, {}]));
    return;
  }

  ws.send(JSON.stringify([3, uniqueId, {}]));
}

function handleMessage(raw) {
  const msg = JSON.parse(raw);
  const type = msg[0];
  const uniqueId = String(msg[1]);

  if (type === 3 && pending.has(uniqueId)) {
    pending.get(uniqueId).resolve(msg[2]);
    pending.delete(uniqueId);
    return;
  }

  if (type === 2) {
    void handleIncomingCall(uniqueId, msg[2], msg[3] ?? {});
  }
}

ws = new WebSocket(url);

ws.on("open", async () => {
  console.log(`[test-cp] Connected as ${chargePointId} → ${url}`);
  try {
    const boot = await sendCall("BootNotification", {
      chargePointVendor: "EV Simulator",
      chargePointModel: "TEST-60DC",
      firmwareVersion: "v1.0.0",
    });
    console.log("[test-cp] BootNotification.conf", boot);

    await sendCall("Heartbeat", {});
    await sendStatus(1, "Available");
    await sendStatus(2, "Unavailable");

    console.log("[test-cp] Ready — use admin Start/Stop; full OCPP session will be simulated");
  } catch (err) {
    console.error("[test-cp] Setup failed:", err.message);
  }
});

ws.on("message", (data) => handleMessage(data.toString()));
ws.on("close", () => {
  stopMeterLoop();
  activeTransactionId = null;
  activeConnectorId = null;
  console.log("[test-cp] Disconnected — meter loop stopped");
});
ws.on("error", (err) => console.error("[test-cp] Error:", err.message));

process.on("SIGINT", () => {
  stopMeterLoop();
  ws?.close();
  process.exit(0);
});
