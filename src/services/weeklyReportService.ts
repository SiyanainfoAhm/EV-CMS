import * as reportService from "@/services/reportService";
import {
  sendWeeklyReportEmail,
  sendEmailInBackground,
  type PowerAutomateEmailResult,
} from "@/services/powerAutomateEmailService";
import { reportsRangeLabel, resolveReportsRange, type ReportsRange } from "@/utils/dateRanges";
import { requireSupabase } from "@/utils/supabaseClient";

interface WeeklyReportRecipient {
  user_id: string;
  email: string;
  full_name: string;
}

export async function sendWeeklyReportsToSubscribers(
  range: ReportsRange = { preset: "week" }
): Promise<{ sent: number; failed: number }> {
  const bounds = resolveReportsRange(range);
  const rangeLabel = reportsRangeLabel(range);
  const bundle = await reportService.getReportsBundleForRange(bounds);

  const { data, error } = await requireSupabase().rpc("ev_list_admins_for_notification", {
    p_category: "weeklyReport",
  });

  if (error) throw error;

  const recipients = (data ?? []) as WeeklyReportRecipient[];
  let sent = 0;
  let failed = 0;

  const topChargers = bundle.chargerUsage.slice(0, 5).map((c) => ({
    name: c.chargerName,
    energyKwh: c.energyKwh,
  }));

  await Promise.all(
    recipients.map(async (recipient) => {
      const result = await sendWeeklyReportEmail({
        name: recipient.full_name,
        email: recipient.email,
        rangeLabel,
        totalEnergyKwh: bundle.summary.totalEnergyKwh,
        totalSessions: bundle.summary.totalSessions,
        totalRevenue: bundle.summary.totalRevenue,
        energyUnit: "kWh",
        currency: "INR",
        topChargers,
      });
      if (result.success) sent += 1;
      else failed += 1;
    })
  );

  return { sent, failed };
}

/** Fire-and-forget weekly digest for the current admin (respects weeklyReport pref). */
export function triggerWeeklyReportForUser(input: {
  userId: string;
  name: string;
  email: string;
  weeklyReportEnabled: boolean;
  energyUnit: string;
  currency: string;
}): Promise<PowerAutomateEmailResult> {
  if (!input.weeklyReportEnabled) {
    return Promise.resolve({ success: false, error: "Weekly report is disabled in your notification settings." });
  }

  const bounds = resolveReportsRange({ preset: "week" });
  const rangeLabel = reportsRangeLabel({ preset: "week" });

  return reportService.getReportsBundleForRange(bounds).then((bundle) =>
    sendWeeklyReportEmail({
      name: input.name,
      email: input.email,
      rangeLabel,
      totalEnergyKwh: bundle.summary.totalEnergyKwh,
      totalSessions: bundle.summary.totalSessions,
      totalRevenue: bundle.summary.totalRevenue,
      energyUnit: input.energyUnit,
      currency: input.currency,
      topChargers: bundle.chargerUsage.slice(0, 5).map((c) => ({
        name: c.chargerName,
        energyKwh: c.energyKwh,
      })),
    })
  );
}

export function sendWeeklyReportsInBackground(
  promise: Promise<{ sent: number; failed: number }>
): void {
  void promise.catch((err) => {
    if (import.meta.env.DEV) console.warn("[weekly-report]", err);
  });
}

export { sendEmailInBackground };
