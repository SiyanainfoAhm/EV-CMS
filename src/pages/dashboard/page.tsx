import { useState, useEffect, useMemo } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import * as dashboardService from "@/services/dashboardService";
import * as notificationService from "@/services/notificationService";
import type { RecentActivityItem } from "@/services/dashboardService";
import type { DashboardPreset, DashboardRange } from "@/utils/dateRanges";
import { dashboardRangeKey, dashboardRangeLabel, utcDaysAgoKey, utcTodayKey } from "@/utils/dateRanges";
import { connectivityFromHeartbeat } from "@/utils/chargerConnectivity";
import { connectorStatusBadgeClass, connectorStatusLabel } from "@/utils/connectorStatus";

const emptyStats = {
  totalChargers: 0,
  onlineChargers: 0,
  offlineChargers: 0,
  faultedChargers: 0,
  activeSessions: 0,
  availableConnectors: 0,
  totalEnergyTodayKwh: 0,
  totalRevenueToday: 0,
  totalSessionsToday: 0,
  avgSessionDuration: "—",
  peakPowerToday: 0,
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatCurrency, formatEnergy, systemSettings } = useUserPreferences();
  const [preset, setPreset] = useState<DashboardPreset>("today");
  const [customStart, setCustomStart] = useState(() => utcDaysAgoKey(7));
  const [customEnd, setCustomEnd] = useState(() => utcTodayKey());
  const [testNotifyLoading, setTestNotifyLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dashboardRange = useMemo<DashboardRange>(
    () =>
      preset === "custom"
        ? { preset: "custom", start: customStart, end: customEnd }
        : { preset },
    [preset, customStart, customEnd]
  );

  const rangeKey = dashboardRangeKey(dashboardRange);

  const { stats, chargers, activeSessions } = useDashboardData(dashboardRange);
  const [energyData, setEnergyData] = useState<{ hour: string; kwh: number }[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);

  const rangeLabel = useMemo(() => dashboardRangeLabel(dashboardRange), [dashboardRange]);

  useEffect(() => {
    dashboardService
      .getEnergyChartData(dashboardRange)
      .then(setEnergyData)
      .catch(console.error);
    dashboardService
      .getRecentActivity(6, dashboardRange)
      .then(setRecentActivity)
      .catch(console.error);
  }, [rangeKey, dashboardRange]);

  const dashboardStats = stats ?? emptyStats;
  const chargerList = chargers;
  const activeSessionList = activeSessions;

  const sendTestNotification = async () => {
    if (!user?.id) return;
    setTestNotifyLoading(true);
    try {
      await notificationService.notifyUser(
        user.id,
        "Test notification",
        `Realtime check at ${new Date().toLocaleTimeString()} — the bell should update without refresh.`,
        "info"
      );
      setToast("Test notification sent — check the bell; minimize tab for browser push");
      setTimeout(() => setToast(null), 3500);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to send test notification");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setTestNotifyLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm">
          {toast}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">Real-time overview of your EV charging infrastructure</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void sendTestNotification()}
            disabled={testNotifyLoading || !user?.id}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors whitespace-nowrap"
            title="Send a test in-app notification to verify realtime bell updates"
          >
            <i className="ri-notification-3-line text-base"></i>
            {testNotifyLoading ? "Sending…" : "Test notification"}
          </button>
          <div className="flex items-center gap-2 bg-white rounded-full border border-gray-200 p-1">
          {(["today", "week", "month", "custom"] as DashboardPreset[]).map((range) => (
            <button
              key={range}
              onClick={() => setPreset(range)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                preset === range
                  ? "bg-emerald-600 text-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {range === "custom" ? "Custom" : range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-sm text-gray-700 bg-transparent focus:outline-none"
                aria-label="Custom range start date"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={utcTodayKey()}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-sm text-gray-700 bg-transparent focus:outline-none"
                aria-label="Custom range end date"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-100">
              <i className="ri-flashlight-line text-emerald-600"></i>
            </div>
            <span className="text-xs text-gray-500">Chargers</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{dashboardStats.totalChargers}</p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="text-emerald-600 font-medium">{dashboardStats.onlineChargers} online</span>
            {" · "}
            <span className="text-gray-500 font-medium">{dashboardStats.offlineChargers} offline</span>
            {" · "}
            <span className="text-red-500 font-medium">{dashboardStats.faultedChargers} faulted</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-orange-100">
              <i className="ri-plug-line text-orange-600"></i>
            </div>
            <span className="text-xs text-gray-500">Active</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{dashboardStats.activeSessions}</p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="text-gray-500">{dashboardStats.availableConnectors} connectors free</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100">
              <i className="ri-flashlight-fill text-amber-600"></i>
            </div>
            <span className="text-xs text-gray-500">Energy {rangeLabel}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatEnergy(dashboardStats.totalEnergyTodayKwh)}</p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="text-gray-500">{systemSettings.energyUnit} consumed</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-100">
              <i className="ri-money-rupee-circle-line text-rose-600"></i>
            </div>
            <span className="text-xs text-gray-500">Revenue {rangeLabel}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {formatCurrency(dashboardStats.totalRevenueToday)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="text-gray-500">{dashboardStats.totalSessionsToday} sessions in {rangeLabel}</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-teal-100">
              <i className="ri-timer-flash-line text-teal-600"></i>
            </div>
            <span className="text-xs text-gray-500">Avg Session {rangeLabel}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{dashboardStats.avgSessionDuration}</p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="text-gray-500">duration</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-100">
              <i className="ri-bar-chart-grouped-line text-indigo-600"></i>
            </div>
            <span className="text-xs text-gray-500">Peak Power {rangeLabel}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{dashboardStats.peakPowerToday}</p>
          <p className="text-xs text-gray-400 mt-1">
            <span className="text-gray-500">kW demand</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-gray-900">Energy Consumption ({systemSettings.energyUnit})</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs text-gray-500">
                  {preset === "today" ? "By hour" : rangeLabel}
                </span>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={energyData}>
              <defs>
                <linearGradient id="energyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  fontSize: "13px",
                }}
              />
              <Area type="monotone" dataKey="kwh" stroke="#059669" strokeWidth={2} fill="url(#energyGradient)" dot={false} activeDot={{ r: 4, fill: "#059669" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent Charging Activity</h3>
          <div className="space-y-3">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3">
                <div
                  className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    activity.type === "alert"
                      ? "bg-red-500"
                      : activity.type === "payment"
                      ? "bg-amber-500"
                      : activity.type === "rfid"
                      ? "bg-indigo-500"
                      : "bg-emerald-500"
                  }`}
                ></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 truncate">{activity.event}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Charger Status</h3>
            <button
              onClick={() => navigate("/chargers")}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium whitespace-nowrap"
            >
              View all &rarr;
            </button>
          </div>
          <div className="space-y-3">
            {chargerList.slice(0, 6).map((charger) => {
              const connectivity = connectivityFromHeartbeat(charger.lastHeartbeat);
              return (
              <div key={charger.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      connectivity === "online"
                        ? "bg-emerald-500"
                        : connectivity === "offline"
                          ? "bg-gray-400"
                          : "bg-amber-400"
                    }`}
                  ></div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{charger.name}</p>
                    <p className="text-xs text-gray-400">
                      {charger.chargePointId} · {charger.location}
                      {charger.status === "faulted" ? " · faulted" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {charger.connectors.map((conn) => (
                    <span
                      key={conn.id}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${connectorStatusBadgeClass(conn.status)}`}
                    >
                      Gun {conn.connectorId}: {connectorStatusLabel(conn.status)}
                    </span>
                  ))}
                </div>
              </div>
            );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Active Sessions</h3>
            <button
              onClick={() => navigate("/sessions")}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium whitespace-nowrap"
            >
              View all &rarr;
            </button>
          </div>
          <div className="space-y-3">
            {activeSessionList.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-100 flex-shrink-0">
                    <i className="ri-flashlight-fill text-emerald-600 text-sm"></i>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{session.userName}</p>
                    <p className="text-xs text-gray-400">{session.chargerName} · Gun {session.connectorId}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{formatEnergy(session.energyKwh ?? 0)}</p>
                  <p className="text-xs text-gray-400">{session.duration}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}