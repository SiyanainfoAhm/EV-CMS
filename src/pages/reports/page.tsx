import { useState, useMemo, useCallback, type ReactNode } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useAsyncData } from "@/hooks/useAsyncData";
import * as reportService from "@/services/reportService";
import * as auditLogService from "@/services/auditLogService";
import { triggerWeeklyReportForUser } from "@/services/weeklyReportService";
import { downloadCsv, printPdfReport } from "@/utils/exportReports";
import {
  resolveReportsRange,
  reportsRangeLabel,
  utcDaysAgoKey,
  utcTodayKey,
  type DashboardRange,
  type ReportsPreset,
  type ReportsRange,
} from "@/utils/dateRanges";
import type { TimeRange } from "@/types/ev";

function ReportShell({
  loading,
  children,
  className = "",
}: {
  loading: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70 backdrop-blur-[1px]">
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <i className="ri-loader-4-line animate-spin text-base"></i>
            Updating…
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { formatCurrency, formatEnergy, formatDateTime, systemSettings, notifications } = useUserPreferences();
  const [preset, setPreset] = useState<ReportsPreset>("week");
  const [customStart, setCustomStart] = useState(() => utcDaysAgoKey(7));
  const [customEnd, setCustomEnd] = useState(() => utcTodayKey());
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [weeklySending, setWeeklySending] = useState(false);

  const reportsRange = useMemo<ReportsRange>(
    () =>
      preset === "custom"
        ? { preset: "custom", start: customStart, end: customEnd }
        : { preset },
    [preset, customStart, customEnd]
  );

  const rangeBounds = useMemo(() => resolveReportsRange(reportsRange), [reportsRange]);
  const rangeSubtitle = reportsRangeLabel(reportsRange);
  const exportKey = preset === "custom" ? `${customStart}_${customEnd}` : preset;
  const rangeMsKey = `${rangeBounds.start.getTime()}-${rangeBounds.end.getTime()}`;

  const dashboardRange = useMemo<DashboardRange | TimeRange>(
    () =>
      preset === "custom"
        ? { preset: "custom", start: customStart, end: customEnd }
        : preset,
    [preset, customStart, customEnd]
  );

  const { stats } = useDashboardData(dashboardRange);

  const {
    data: bundle,
    loading: bundleLoading,
    error: bundleError,
  } = useAsyncData(() => reportService.getReportsBundleForRange(rangeBounds), [rangeMsKey]);

  const { data: faultRows, loading: faultsLoading } = useAsyncData(
    () => reportService.getFaultOfflineReport(),
    []
  );

  const summary = bundle?.summary ?? {
    totalEnergyKwh: 0,
    totalSessions: 0,
    totalRevenue: 0,
    avgEnergyPerSession: 0,
  };

  const chargerChartData = useMemo(
    () =>
      (bundle?.chargerUsage ?? []).map((c) => ({
        name: c.chargePointId,
        energy: c.energyKwh,
        chargerName: c.chargerName,
        sessions: c.sessions,
      })),
    [bundle]
  );

  const dailyRevenue = useMemo(
    () => (bundle?.dailyChart ?? []).map((d) => ({ day: d.day, revenue: d.revenue })),
    [bundle]
  );

  const sessionsPerDay = useMemo(
    () => (bundle?.dailyChart ?? []).map((d) => ({ day: d.day, sessions: d.sessions })),
    [bundle]
  );

  const dashboardStats = stats ?? {
    onlineChargers: 0,
    offlineChargers: 0,
    faultedChargers: 0,
    totalChargers: 0,
    activeSessions: 0,
  };

  const totalChargers = dashboardStats.totalChargers || 1;
  const isLoading = bundleLoading;

  const showExportToast = (msg: string) => {
    setExportToast(msg);
    setTimeout(() => setExportToast(null), 3000);
  };

  const logExport = useCallback(
    async (reportName: string, format: string) => {
      if (!user?.id) return;
      try {
        await auditLogService.logReportExport({
          userId: user.id,
          reportName,
          format,
          rangeLabel: rangeSubtitle,
        });
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[audit] export log failed", e);
      }
    },
    [user?.id, rangeSubtitle]
  );

  const exportEnergyCsv = () => {
    downloadCsv(
      `energy-usage-${exportKey}.csv`,
      ["Charge Point ID", "Charger Name", "Sessions", "Energy kWh"],
      chargerChartData.map((c) => [c.name, c.chargerName, c.sessions, c.energy])
    );
    void logExport("Energy Usage Report", "CSV");
    showExportToast("Energy usage CSV downloaded");
  };

  const exportRevenueCsv = () => {
    downloadCsv(
      `revenue-summary-${exportKey}.csv`,
      ["Day", "Revenue INR", "Sessions"],
      (bundle?.dailyChart ?? []).map((d) => [d.day, d.revenue, d.sessions])
    );
    void logExport("Revenue Summary", "CSV");
    showExportToast("Revenue summary exported (CSV)");
  };

  const exportSessionsCsv = () => {
    downloadCsv(
      `session-history-${exportKey}.csv`,
      ["Txn ID", "User", "Charger", "Start", "End", "Energy kWh", "Amount", "Status", "Auth", "Stop Reason"],
      (bundle?.sessions ?? []).map((s) => [
        s.transactionId,
        s.userName,
        s.chargerName,
        formatDateTime(s.startTime),
        s.endTime ? formatDateTime(s.endTime) : "",
        s.energyKwh,
        s.amount != null ? formatCurrency(s.amount) : "",
        s.status,
        s.authMethod ?? "",
        s.stopReason ?? "",
      ])
    );
    void logExport("Session History", "CSV");
    showExportToast("Session history CSV downloaded");
  };

  const exportUserWiseCsv = () => {
    downloadCsv(
      `user-wise-usage-${exportKey}.csv`,
      ["User", "Sessions", "Energy kWh", "Revenue INR"],
      (bundle?.userWise ?? []).map((u) => [u.userName, u.sessions, u.energyKwh, u.revenue])
    );
    void logExport("User-wise Usage", "CSV");
    showExportToast("User-wise usage CSV downloaded");
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
    void logExport("Fault & Offline Report", "PDF");
    showExportToast("Fault report sent to print / PDF");
  };

  const sendMyWeeklyReport = async () => {
    if (!user?.email) return;
    setWeeklySending(true);
    try {
      const result = await triggerWeeklyReportForUser({
        userId: user.id,
        name: user.name,
        email: user.email,
        weeklyReportEnabled: notifications.weeklyReport,
        energyUnit: systemSettings.energyUnit,
        currency: systemSettings.currency,
      });
      showExportToast(
        result.success
          ? "Weekly summary email sent — check your inbox"
          : result.error ?? "Could not send weekly report"
      );
    } finally {
      setWeeklySending(false);
    }
  };

  return (
    <div className="space-y-5">
      {exportToast && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm shadow-lg max-w-sm">
          {exportToast}
        </div>
      )}

      {bundleError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load report data: {bundleError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Reports &amp; Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">Usage insights, energy trends, and revenue analysis</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void sendMyWeeklyReport()}
            disabled={weeklySending || !user?.email}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors whitespace-nowrap"
            title="Send this week's summary to your email (requires weekly report enabled in Settings)"
          >
            <i className="ri-mail-send-line text-base"></i>
            {weeklySending ? "Sending…" : "Email weekly summary"}
          </button>
          <div className="flex items-center gap-2 bg-white rounded-full border border-gray-200 p-1">
            {(["today", "week", "month", "quarter", "custom"] as ReportsPreset[]).map((range) => (
              <button
                key={range}
                onClick={() => setPreset(range)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                  preset === range ? "bg-emerald-600 text-white" : "text-gray-500 hover:text-gray-700"
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

      <ReportShell loading={isLoading}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Total Energy</p>
            <p className="text-2xl font-bold text-gray-900">{formatEnergy(summary.totalEnergyKwh)}</p>
            <p className="text-xs text-gray-400 mt-1">{systemSettings.energyUnit} consumed · {rangeSubtitle}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Total Sessions</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalSessions}</p>
            <p className="text-xs text-gray-400 mt-1">completed · {rangeSubtitle}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.totalRevenue)}</p>
            <p className="text-xs text-gray-400 mt-1">successful payments · {rangeSubtitle}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Avg Energy/Session</p>
            <p className="text-2xl font-bold text-gray-900">{formatEnergy(summary.avgEnergyPerSession)}</p>
            <p className="text-xs text-gray-400 mt-1">{systemSettings.energyUnit}</p>
          </div>
        </div>
      </ReportShell>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReportShell loading={isLoading} className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            Charger-wise Energy ({systemSettings.energyUnit})
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chargerChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                axisLine={false}
                tickLine={false}
                angle={-45}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }} />
              <Bar dataKey="energy" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportShell>

        <ReportShell loading={isLoading} className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Daily Revenue ({systemSettings.currency})</h3>
          <p className="text-[10px] text-gray-400 mb-2">From successful payments (EV_Payments)</p>
          <ResponsiveContainer width="100%" height={260}>
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
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#059669"
                strokeWidth={2}
                fill="url(#revGrad)"
                dot={{ r: 3, fill: "#059669" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ReportShell>

        <ReportShell loading={isLoading} className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Sessions Per Day</h3>
          <p className="text-[10px] text-gray-400 mb-2">Completed sessions by start date</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sessionsPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }} />
              <Bar dataKey="sessions" fill="#d97706" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ReportShell>

        <ReportShell loading={faultsLoading} className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Charger Status Distribution</h3>
          <p className="text-[10px] text-gray-400 mb-4">Current live status (not filtered by date range)</p>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs text-gray-500">Online ({dashboardStats.onlineChargers})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                <span className="text-xs text-gray-500">Offline ({dashboardStats.offlineChargers})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                <span className="text-xs text-gray-500">Faulted ({dashboardStats.faultedChargers})</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 36 36" className="w-32 h-32 -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#f0f0f0" strokeWidth="3"></circle>
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#059669"
                  strokeWidth="3"
                  strokeDasharray={`${(dashboardStats.onlineChargers / totalChargers) * 88} 88`}
                  strokeLinecap="round"
                ></circle>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-gray-900">
                  {dashboardStats.onlineChargers}/{totalChargers}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                <strong className="text-gray-900">
                  {((dashboardStats.onlineChargers / totalChargers) * 100).toFixed(0)}%
                </strong>{" "}
                online rate
              </p>
              <p>
                <strong className="text-gray-900">{dashboardStats.onlineChargers}</strong> charging ready
              </p>
              <p>
                <strong className="text-gray-900">
                  {dashboardStats.offlineChargers + dashboardStats.faultedChargers}
                </strong>{" "}
                need attention
              </p>
            </div>
          </div>
        </ReportShell>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Export Reports</h3>
          <p className="text-[10px] text-gray-400">Exports are logged in Audit Logs</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Energy Usage", icon: "ri-flashlight-line", format: "CSV", onClick: exportEnergyCsv },
            { label: "Revenue Summary", icon: "ri-money-rupee-circle-line", format: "CSV", onClick: exportRevenueCsv },
            { label: "Session History", icon: "ri-timer-line", format: "CSV", onClick: exportSessionsCsv },
            { label: "User-wise Usage", icon: "ri-group-line", format: "CSV", onClick: exportUserWiseCsv },
            { label: "Fault & Offline", icon: "ri-error-warning-line", format: "PDF", onClick: exportFaultPdf },
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
        <ReportShell loading={isLoading} className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h3 className="text-sm font-semibold text-gray-900">User-wise Usage ({rangeSubtitle})</h3>
            <button
              type="button"
              onClick={exportUserWiseCsv}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 whitespace-nowrap"
            >
              Export CSV
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mb-2">Revenue from successful payments; energy from completed sessions</p>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="text-left py-2">User</th>
                  <th className="text-right py-2">Sessions</th>
                  <th className="text-right py-2">{systemSettings.energyUnit}</th>
                  <th className="text-right py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(bundle?.userWise ?? []).map((u) => (
                  <tr key={u.userId} className="border-b border-gray-50">
                    <td className="py-2 text-gray-900">{u.userName}</td>
                    <td className="py-2 text-right text-gray-600">{u.sessions}</td>
                    <td className="py-2 text-right text-gray-600">{formatEnergy(u.energyKwh)}</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(u.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(bundle?.userWise ?? []).length === 0 && !isLoading && (
              <p className="text-xs text-gray-400 py-6 text-center">No session data in this range</p>
            )}
          </div>
        </ReportShell>

        <ReportShell loading={faultsLoading} className="bg-white rounded-xl border border-gray-200 p-5">
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
            {(faultRows ?? []).length === 0 && !faultsLoading && (
              <p className="text-xs text-emerald-600 py-6 text-center">All chargers healthy</p>
            )}
          </div>
        </ReportShell>
      </div>
    </div>
  );
}
