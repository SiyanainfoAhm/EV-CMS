import { useState, useEffect } from "react";
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
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import * as dashboardService from "@/services/dashboardService";
import type { RecentActivityItem } from "@/services/dashboardService";
import type { TimeRange } from "@/types/ev";
import { connectivityFromHeartbeat } from "@/utils/chargerConnectivity";

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
  const { formatCurrency, formatEnergy } = useUserPreferences();
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const { stats, chargers, activeSessions } = useDashboardData(timeRange);
  const [energyData, setEnergyData] = useState<{ hour: string; kwh: number }[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>([]);

  const rangeLabel = timeRange === "today" ? "Today" : timeRange.charAt(0).toUpperCase() + timeRange.slice(1);

  useEffect(() => {
    dashboardService
      .getEnergyChartData(timeRange)
      .then(setEnergyData)
      .catch(console.error);
    dashboardService
      .getRecentActivity(6, timeRange)
      .then(setRecentActivity)
      .catch(console.error);
  }, [timeRange]);

  const dashboardStats = stats ?? emptyStats;
  const chargerList = chargers;
  const activeSessionList = activeSessions;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">Real-time overview of your EV charging infrastructure</p>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-full border border-gray-200 p-1">
          {(["today", "week", "month"] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                timeRange === range
                  ? "bg-emerald-600 text-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
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
            <span className="text-gray-500">kWh consumed</span>
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
            <h3 className="text-sm font-semibold text-gray-900">Energy Consumption (kWh)</h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs text-gray-500">Today</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-200"></span>
                <span className="text-xs text-gray-500">Yesterday</span>
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
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        conn.status === "Charging"
                          ? "bg-emerald-100 text-emerald-700"
                          : conn.status === "Available"
                          ? "bg-gray-100 text-gray-600"
                          : conn.status === "Faulted"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      Gun {conn.connectorId}: {conn.status}
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
                  <p className="text-sm font-semibold text-gray-900">{session.energyKwh} kWh</p>
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