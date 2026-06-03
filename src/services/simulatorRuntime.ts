import * as simulator from "@/services/chargerSimulatorService";

const HEARTBEAT_MS = 60_000;
const METER_MS = 30_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let meterTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

export function isSimulatorRuntimeActive(): boolean {
  return started;
}

export async function startSimulatorRuntime(): Promise<void> {
  if (started) return;
  started = true;

  try {
    await simulator.createDemoChargers();
    await simulator.simulateHeartbeatAll();
  } catch (e) {
    console.warn("[simulatorRuntime] init:", e);
  }

  heartbeatTimer = setInterval(() => {
    simulator.simulateHeartbeatAll().catch((e) => console.warn("[simulatorRuntime] heartbeat:", e));
  }, HEARTBEAT_MS);

  meterTimer = setInterval(() => {
    simulator.simulateMeterAllActive().catch((e) => console.warn("[simulatorRuntime] meter:", e));
  }, METER_MS);
}

export function stopSimulatorRuntime(): void {
  started = false;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (meterTimer) clearInterval(meterTimer);
  heartbeatTimer = null;
  meterTimer = null;
}
