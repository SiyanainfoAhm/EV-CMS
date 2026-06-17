import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useAsyncData } from "@/hooks/useAsyncData";
import * as sessionService from "@/services/sessionService";
import * as reportService from "@/services/reportService";
import { downloadCsv, printPdfReport } from "@/utils/exportReports";
import { utcRangeStart } from "@/utils/dateRanges";
import type { TimeRange } from "@/types/ev";

export default function ReportsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("week");
  const { chargers, stats, activeSessions } = useDashboardData(timeRange);
  const days = timeRange === "week" ? 7 : timeRange === "month" ? 30 : 90;
  const rangeSubtitle = timeRange === "week" ? "this week" : timeRange === "month" ? "this month" : "this quarter";
  const { data: historyData } = useAsyncData(() => sessionService.getSessionHistory({ limit: 2000 }), []);
  const { data: chartData } = useAsyncData(() => reportService.getDailyRevenueAndSessions(days), [days]);
  const { data: userWise } = useAsyncData(() => reportService.getUserWiseReport(days), [days]);
  const { data: faultRows } = useAsyncData(() => reportService.getFaultOfflineReport(), []);
  const [exportToast, setExportToast] = useState<string | null>(null);
  const dailyRevenue = useMemo(
    () => (chartData ?? []).map((d) => ({ day: d.day, revenue: d.revenue })),
    [chartData]
  );
  const sessionsPerDay = useMemo(
    () => (chartData ?? []).map((d) => ({ day: d.day, sessions: d.sessions })),
    [chartData]
  );
  const mockChargers = chargers;
  const mockSessionHistory = historyData ?? [];
  const mockDashboardStats = stats ?? {
    onlineChargers: 0,
    offlineChargers: 0,
    faultedChargers: 0,
    totalChargers: 0,
    activeSessions: 0,
  };

  const rangeStart = useMemo(() => utcRangeStart(days), [days]);

  const filteredSessionHistory = useMemo(
    () => mockSessionHistory.filter((s) => new Date(s.startTime).getTime() >= rangeStart.getTime()),
    [mockSessionHistory, rangeStart],
  );

  const filteredActiveSessions = useMemo(
    () => activeSessions.filter((s) => new Date(s.startTime).getTime() >= rangeStart.getTime()),
    [activeSessions, rangeStart],
  );

  const chargerUsage = useMemo(
    () =>
      mockChargers.map((c) => {
        const completed = filteredSessionHistory.filter((s) => s.chargePointId === c.chargePointId);
        const active = filteredActiveSessions.filter((s) => s.chargePointId === c.chargePointId);
        const sessions = [...active, ...completed];
        const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyKwh || 0), 0);
        return {
          name: c.chargePointId,
          energy: parseFloat(totalEnergy.toFixed(1)),
          sessions: sessions.length,
        };
      }),
    [mockChargers, filteredSessionHistory, filteredActiveSessions],
  );

  const summaryStats = useMemo(() => {
    const totalEnergy = chargerUsage.reduce((sum, c) => sum + c.energy, 0);
    const totalSessions = filteredSessionHistory.length + filteredActiveSessions.length;
    const totalRevenue = dailyRevenue.reduce((sum, d) => sum + d.revenue, 0);
    const avgEnergyPerSession = totalSessions > 0 ? (totalEnergy / totalSessions).toFixed(1) : "0";
    return { totalEnergy, totalSessions, totalRevenue, avgEnergyPerSession };
  }, [chargerUsage, filteredSessionHistory, filteredActiveSessions, dailyRevenue]);

  const totalChargers = mockDashboardStats.totalChargers || mockChargers.length || 1;

  const showExportToast = (msg: string) => {
    setExportToast(msg);
    setTimeout(() => setExportToast(null), 3000);
  };

  const exportEnergyCsv = () => {
    downloadCsv(
      `energy-usage-${timeRange}.csv`,
      ["Charge Point ID", "Charger Name", "Sessions", "Energy kWh"],
      chargerUsage.map((c) => {
        const ch = mockChargers.find((x) => x.chargePointId === c.name);
        return [c.name, ch?.name ?? c.name, c.sessions, c.energy];
      }),
    );
    showExportToast("Energy usage CSV downloaded");
  };

  const exportRevenueCsv = () => {
    downloadCsv(
      `revenue-summary-${timeRange}.csv`,
      ["Day", "Revenue INR", "Sessions"],
      (chartData ?? []).map((d) => [d.day, d.revenue, d.sessions]),
    );
    showExportToast("Revenue summary exported (CSV — open in Excel)");
  };

  const exportSessionsCsv = () => {
    downloadCsv(
      `session-history-${timeRange}.csv`,
      ["Txn ID", "User", "Charger", "Start", "End", "Energy kWh", "Amount", "Status", "Auth", "Stop Reason"],
      filteredSessionHistory.map((s) => [
        s.transactionId,
        s.userName,
        s.chargerName,
        s.startTime,
        s.endTime ?? "",
        s.energyKwh,
        s.amount ?? "",
        s.status,
        s.authMethod ?? "",
        s.stopReason ?? "",
      ]),
    );
    showExportToast("Session history CSV downloaded");
  };

  const exportFaultPdf = () => {
    const rows = faultRows ?? [];
    printPdfReport("Fault & Offline Charger Report", [
      {
        heading: `Summary (${rows.length} chargers need attention)`,
        lines: rows.length
          ? rows.map((r) => `${r.chargePointId} — ${r.name}: ${r.status} / ${r.connectivity} · ${r.location}`)
          : ["All chargers online — no faults or offline units"],
      },
    ]);
    showExportToast("Fault report sent to print / PDF");
  };

  return (
    <div className="space-y-5">
      {exportToast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg">
          {exportToast}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Reports &amp; Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">Usage insights, energy trends, and revenue analysis</p>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-full border border-gray-200 p-1">
          {(["week", "month", "quarter"] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                timeRange === range ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Energy</p>
          <p className="text-2xl font-bold text-gray-900">{summaryStats.totalEnergy}</p>
          <p className="text-xs text-gray-400 mt-1">kWh consumed</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Sessions</p>
          <p className="text-2xl font-bold text-gray-900">{summaryStats.totalSessions}</p>
          <p className="text-xs text-gray-400 mt-1">{rangeSubtitle}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
          <p className="text-2xl font-bold text-gray-900">&#8377;{summaryStats.totalRevenue.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">{rangeSubtitle}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Avg Energy/Session</p>
          <p className="text-2xl font-bold text-gray-900">{summaryStats.avgEnergyPerSession}</p>
          <p className="text-xs text-gray-400 mt-1">kWh</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Charger-wise Energy (kWh)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chargerUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} angle={-45} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }} />
              <Bar dataKey="energy" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Daily Revenue (&#8377;)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={dailyRevenue}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }} />
              <Area type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={2} fill="url(#revGrad)" dot={{ r: 3, fill: "#059669" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Sessions Per Day</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={sessionsPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }} />
              <Bar dataKey="sessions" fill="#d97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Charger Status Distribution</h3>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs text-gray-500">Online ({mockDashboardStats.onlineChargers})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                <span className="text-xs text-gray-500">Offline ({mockDashboardStats.offlineChargers})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                <span className="text-xs text-gray-500">Faulted ({mockDashboardStats.faultedChargers})</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 36 36" className="w-32 h-32 -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#f0f0f0" strokeWidth="3"></circle>
                <circle
                  cx="18" cy="18" r="14" fill="none" stroke="#059669" strokeWidth="3"
                  strokeDasharray={`${(mockDashboardStats.onlineChargers / totalChargers) * 88} 88`}
                  strokeLinecap="round"
                ></circle>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900">
                  {mockDashboardStats.onlineChargers}/{totalChargers}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                <strong className="text-gray-900">
                  {((mockDashboardStats.onlineChargers / totalChargers) * 100).toFixed(0)}%
                </strong>{" "}
                online rate
              </p>
              <p><strong className="text-gray-900">{mockDashboardStats.onlineChargers}</strong> charging ready</p>
              <p><strong className="text-gray-900">{mockDashboardStats.offlineChargers + mockDashboardStats.faultedChargers}</strong> need attention</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Export Reports</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Energy Usage Report", icon: "ri-flashlight-line", format: "CSV", onClick: exportEnergyCsv },
            { label: "Revenue Summary", icon: "ri-money-rupee-circle-line", format: "CSV", onClick: exportRevenueCsv },
            { label: "Session History", icon: "ri-timer-line", format: "CSV", onClick: exportSessionsCsv },
            { label: "Fault & Offline Report", icon: "ri-error-warning-line", format: "PDF", onClick: exportFaultPdf },
          ].map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={r.onClick}
              className="flex flex-col items-center gap-2 p-4 bg-[#f5f5f3] rounded-xl hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-all cursor-pointer"
            >
              <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-white border border-gray-200">
                <i className={`${r.icon} text-emerald-600`}></i>
              </div>
              <span className="text-xs font-medium text-gray-700 text-center">{r.label}</span>
              <span className="text-[10px] text-gray-400">{r.format}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">User-wise Usage ({rangeSubtitle})</h3>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left py-2">User</th>
                  <th className="text-right py-2">Sessions</th>
                  <th className="text-right py-2">kWh</th>
                  <th className="text-right py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(userWise ?? []).slice(0, 15).map((u) => (
                  <tr key={u.userId} className="border-b border-gray-50">
                    <td className="py-2 text-gray-900">{u.userName}</td>
                    <td className="py-2 text-right text-gray-600">{u.sessions}</td>
                    <td className="py-2 text-right text-gray-600">{u.energyKwh.toFixed(1)}</td>
                    <td className="py-2 text-right font-medium">₹{u.revenue.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(userWise ?? []).length === 0 && (
              <p className="text-xs text-gray-400 py-6 text-center">No session data in this range</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Fault & Offline Chargers</h3>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left py-2">Charger</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Connectivity</th>
                </tr>
              </thead>
              <tbody>
                {(faultRows ?? []).map((r) => (
                  <tr key={r.chargePointId} className="border-b border-gray-50">
                    <td className="py-2">
                      <p className="font-medium text-gray-900">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.chargePointId}</p>
                    </td>
                    <td className="py-2 capitalize text-gray-600">{r.status}</td>
                    <td className="py-2 capitalize text-gray-600">{r.connectivity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(faultRows ?? []).length === 0 && (
              <p className="text-xs text-emerald-600 py-6 text-center">All chargers healthy</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}