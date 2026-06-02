import { useState, useMemo } from "react";
import { useAsyncData } from "@/hooks/useAsyncData";
import * as chargerService from "@/services/chargerService";
import * as sessionService from "@/services/sessionService";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type TabType = "active" | "history";

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SessionsPage() {
  const { data: activeData } = useAsyncData(() => sessionService.getActiveSessions(), []);
  useAsyncData(() => chargerService.getChargers(), []);
  const mockActiveSessions = activeData ?? [];
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const { data: historyData } = useAsyncData(
    () => sessionService.getSessionHistory({ status: statusFilter, search: debouncedSearch }),
    [statusFilter, debouncedSearch],
  );
  const mockSessionHistory = historyData ?? [];
  const [stopModal, setStopModal] = useState<string | null>(null);
  const [stopResult, setStopResult] = useState<string | null>(null);

  const allSessions = useMemo(() => {
    const active = mockActiveSessions;
    const history = [...mockSessionHistory].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
    return { active, history };
  }, [mockActiveSessions, mockSessionHistory]);

  const filteredHistory = useMemo(() => allSessions.history, [allSessions.history]);

  const stats = useMemo(() => {
    const todayStr = "2026-06-01";
    const todayHistory = allSessions.history.filter((s) => s.startTime.startsWith(todayStr));
    const energyToday = todayHistory.reduce((sum, s) => sum + (s.energyKwh || 0), 0);
    const revenueToday = todayHistory.reduce((sum, s) => sum + (s.amount || 0), 0);
    return {
      active: allSessions.active.length,
      completedToday: todayHistory.filter((s) => s.status === "completed").length,
      energyToday: energyToday.toFixed(1),
      revenueToday: revenueToday,
    };
  }, [allSessions]);

  const handleRemoteStop = (sessionId: string) => {
    setStopModal(sessionId);
  };

  const confirmStop = () => {
    setStopModal(null);
    setStopResult("RemoteStop command sent to charger. Awaiting response...");
    setTimeout(() => setStopResult(null), 4000);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Charging Sessions
          </h1>
          <p className="text-sm text-gray-500 mt-1">Monitor active sessions and review charging history</p>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-full border border-gray-200 p-1">
          <button
            onClick={() => setActiveTab("active")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === "active" ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Active ({stats.active})
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === "history" ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            History
          </button>
        </div>
      </div>

      {stopResult && (
        <div className="p-4 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800 flex items-center gap-2">
          <div className="w-5 h-5 flex items-center justify-center">
            <i className="ri-checkbox-circle-line"></i>
          </div>
          <p className="text-sm font-medium">{stopResult}</p>
          <button
            onClick={() => setStopResult(null)}
            className="ml-auto w-6 h-6 flex items-center justify-center rounded hover:bg-black/10 transition-colors"
          >
            <i className="ri-close-line text-sm"></i>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0"></div>
            <span className="text-xs text-gray-500">Active Now</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-check-double-line text-emerald-600 text-sm"></i>
            <span className="text-xs text-gray-500">Completed Today</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.completedToday}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-flashlight-fill text-amber-600 text-sm"></i>
            <span className="text-xs text-gray-500">Energy Today</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stats.energyToday} kWh</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <i className="ri-money-rupee-circle-line text-rose-600 text-sm"></i>
            <span className="text-xs text-gray-500">Revenue Today</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">&#8377;{stats.revenueToday.toLocaleString()}</p>
        </div>
      </div>

      {activeTab === "active" ? (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Session ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Charger</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Connector</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Start Time</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Energy</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Power</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allSessions.active.map((session) => (
                  <tr key={session.id} className="border-b border-gray-50">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-500">#{session.transactionId}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{session.userName}</p>
                        <p className="text-xs text-gray-400">{session.rfidTag}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-gray-700">{session.chargerName}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">Gun {session.connectorId} · {session.connectorType}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-gray-600">{formatTime(session.startTime)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{session.duration}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-gray-900">{session.energyKwh} kWh</p>
                      <p className="text-xs text-gray-400">SoC {session.soc}%</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-gray-700">{session.currentPowerKw} kW</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRemoteStop(session.id)}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors whitespace-nowrap flex items-center gap-1"
                        >
                          <div className="w-3.5 h-3.5 flex items-center justify-center">
                            <i className="ri-stop-circle-line"></i>
                          </div>
                          Stop
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                  <input
                    type="text"
                    placeholder="Search by user, charger, RFID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-[#f5f5f3] border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="all">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="stopped">Stopped</option>
                  <option value="faulted">Faulted</option>
                </select>
              </div>
              <p className="text-xs text-gray-400">
                {filteredHistory.length} sessions
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Txn ID</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Charger</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Start</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">End</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Duration</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Energy</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Stop Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((session) => (
                  <tr key={session.id} className="border-b border-gray-50 hover:bg-[#f9faf7] transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-mono text-gray-500">#{session.transactionId}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{session.userName}</p>
                      {session.rfidTag && <p className="text-xs text-gray-400">{session.rfidTag}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-gray-700">{session.chargerName}</p>
                      <p className="text-xs text-gray-400">Gun {session.connectorId}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-gray-600">{formatTime(session.startTime)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-gray-600">
                        {session.endTime ? formatTime(session.endTime) : <span className="text-gray-400">—</span>}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-gray-700">{session.duration || "—"}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-gray-900">
                        {session.energyKwh != null ? `${session.energyKwh} kWh` : "—"}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-gray-900">
                        {session.amount != null ? `₹${session.amount}` : "—"}
                      </p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          session.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : session.status === "stopped"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {session.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs text-gray-500 max-w-40 truncate">{session.stopReason}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredHistory.length === 0 && (
            <div className="py-16 text-center">
              <div className="w-12 h-12 flex items-center justify-center rounded-full bg-gray-100 mx-auto mb-3">
                <i className="ri-search-line text-gray-300 text-xl"></i>
              </div>
              <p className="text-sm text-gray-400">No sessions match your search</p>
            </div>
          )}
        </div>
      )}

      {stopModal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setStopModal(null)}></div>
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-red-100">
                  <i className="ri-stop-circle-line text-red-600 text-lg"></i>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Stop Charging Session</h4>
                  <p className="text-xs text-gray-500">RemoteStop command will be sent</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to stop session {stopModal}? The charger will stop dispensing power immediately.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStopModal(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmStop}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors whitespace-nowrap"
                >
                  Stop Session
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}