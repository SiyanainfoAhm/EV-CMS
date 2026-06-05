import { useCallback, useEffect, useState } from "react";
import SimulationModeBadge from "@/components/common/SimulationModeBadge";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseRealtime } from "@/hooks/useSupabaseRealtime";
import * as simulator from "@/services/chargerSimulatorService";
import { startSimulatorRuntime, stopSimulatorRuntime, isSimulatorRuntimeActive } from "@/services/simulatorRuntime";
import {
  connectivityFromHeartbeat,
  formatHeartbeatAgo,
} from "@/utils/chargerConnectivity";
import { listSimulatorUsers } from "@/services/simulatorPageHelpers";

export default function SimulatorPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<simulator.SimulatorChargerRow[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState("");
  const [runtimeOn, setRuntimeOn] = useState(isSimulatorRuntimeActive());
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [chargers, operatorList] = await Promise.all([
      simulator.listSimulatorChargers(),
      listSimulatorUsers(),
    ]);
    setRows(chargers);
    setUsers(operatorList);
    if (!selectedUserId && operatorList[0]) setSelectedUserId(operatorList[0].id);
  }, [selectedUserId]);

  useEffect(() => {
    load().catch((e) => setMessage(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  useSupabaseRealtime(() => {
    load().catch(() => undefined);
  });

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  };

  if (user?.role !== "SuperAdmin") {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-600">
        Simulator is available to Admin roles only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Charger Simulator
        </h1>
        <p className="text-sm text-gray-500 mt-1">OCPP-ready simulation — all actions write to Supabase</p>
      </div>

      <SimulationModeBadge />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() =>
            run("demo", async () => {
              const n = await simulator.createDemoChargers();
              setMessage(`Created ${n} demo charger(s)`);
            })
          }
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Create 12 Demo Chargers
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() =>
            run("hb-all", async () => {
              const n = await simulator.simulateHeartbeatAll();
              setMessage(`Heartbeat sent to ${n} charger(s)`);
            })
          }
          className="px-4 py-2 bg-white border rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Heartbeat All
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => {
            if (runtimeOn) {
              stopSimulatorRuntime();
              setRuntimeOn(false);
              setMessage("Auto simulator stopped");
            } else {
              startSimulatorRuntime();
              setRuntimeOn(true);
              setMessage("Auto heartbeat (60s) + meter (30s) started");
            }
          }}
          className="px-4 py-2 bg-white border rounded-lg text-sm font-medium"
        >
          {runtimeOn ? "Stop Auto Simulator" : "Start Auto Simulator"}
        </button>
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {message ? (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">{message}</p>
      ) : null}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Charger</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Heartbeat</th>
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((c) => {
              const conn = connectivityFromHeartbeat(c.lastHeartbeat);
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.chargePointId}</p>
                    <p className="text-xs text-gray-500">{c.name}</p>
                    {c.isSimulated ? (
                      <span className="text-xs text-amber-600">simulated</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 capitalize">{c.status}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        conn === "online"
                          ? "text-emerald-600"
                          : conn === "offline"
                            ? "text-red-500"
                            : "text-amber-600"
                      }
                    >
                      ● {conn}
                    </span>
                    <p className="text-xs text-gray-400">{formatHeartbeatAgo(c.lastHeartbeat)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.activeSessionId ? `Gun ${c.activeConnectorId} · ${c.activeSessionId.slice(0, 8)}…` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <ActionBtn
                        label="HB"
                        busy={busy}
                        onClick={() => run(`hb-${c.id}`, () => simulator.simulateHeartbeat(c.id).then(() => undefined))}
                      />
                      <ActionBtn
                        label="Avail"
                        busy={busy}
                        onClick={() =>
                          run(`st-${c.id}`, () => simulator.simulateStatusChange(c.id, "Available"))
                        }
                      />
                      <ActionBtn
                        label="Fault"
                        busy={busy}
                        onClick={() => run(`sf-${c.id}`, () => simulator.simulateStatusChange(c.id, "Faulted"))}
                      />
                      <ActionBtn
                        label="Off"
                        busy={busy}
                        onClick={() => run(`so-${c.id}`, () => simulator.simulateStatusChange(c.id, "Offline"))}
                      />
                      <ActionBtn
                        label="Start"
                        busy={busy}
                        disabled={!selectedUserId}
                        onClick={() =>
                          run(`ss-${c.id}`, async () => {
                            const sid = await simulator.simulateStartSession(c.id, 1, selectedUserId);
                            setMessage(`Session ${sid.slice(0, 8)}… started`);
                          })
                        }
                      />
                      {c.activeSessionId ? (
                        <>
                          <ActionBtn
                            label="Meter"
                            busy={busy}
                            onClick={() =>
                              run(`mv-${c.id}`, async () => {
                                const kwh = await simulator.simulateMeterValue(c.activeSessionId!);
                                setMessage(`Meter → ${kwh} kWh`);
                              })
                            }
                          />
                          <ActionBtn
                            label="Stop"
                            busy={busy}
                            onClick={() =>
                              run(`stp-${c.id}`, () => simulator.simulateStopSession(c.activeSessionId!))
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  busy,
  disabled,
}: {
  label: string;
  onClick: () => void;
  busy: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={!!busy || disabled}
      onClick={onClick}
      className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
