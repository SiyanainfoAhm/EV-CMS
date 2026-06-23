// Scheduled weekly digest for admins with weeklyReport notification enabled.
// Deploy: supabase functions deploy send-weekly-reports --no-verify-jwt
// Secrets: POWER_AUTOMATE_EMAIL_URL (HTTP POST URL from Power Automate flow)
// Optional: WEEKLY_REPORT_SECRET — pass as x-weekly-report-secret header when invoking manually
// Schedule: see supabase/weekly_report_cron.sql (pg_cron + pg_net)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-weekly-report-secret",
};

function utcRangeStart(days: number): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

async function postEmail(flowUrl: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(flowUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const secret = Deno.env.get("WEEKLY_REPORT_SECRET");
  if (secret && req.headers.get("x-weekly-report-secret") !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const flowUrl = Deno.env.get("POWER_AUTOMATE_EMAIL_URL")?.trim();
  if (!flowUrl) {
    return new Response(JSON.stringify({ error: "POWER_AUTOMATE_EMAIL_URL not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = utcRangeStart(7);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [recipientsRes, paymentsRes, sessionsRes, chargerSessionsRes] = await Promise.all([
    supabase.rpc("ev_list_admins_for_notification", { p_category: "weeklyReport" }),
    supabase
      .from("EV_Payments")
      .select("total_amount")
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .eq("status", "success"),
    supabase
      .from("EV_ChargingSessions")
      .select("id")
      .eq("status", "completed")
      .gte("start_time", startIso)
      .lte("start_time", endIso),
    supabase
      .from("EV_ChargingSessions")
      .select("energy_kwh, EV_Chargers(name)")
      .eq("status", "completed")
      .gte("start_time", startIso)
      .lte("start_time", endIso),
  ]);

  if (recipientsRes.error) {
    return new Response(JSON.stringify({ error: recipientsRes.error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const totalRevenue = (paymentsRes.data ?? []).reduce(
    (sum, row) => sum + Number((row as { total_amount: number }).total_amount ?? 0),
    0
  );
  const totalSessions = sessionsRes.data?.length ?? 0;
  const totalEnergy = (chargerSessionsRes.data ?? []).reduce(
    (sum, row) => sum + Number((row as { energy_kwh: number }).energy_kwh ?? 0),
    0
  );

  const byCharger = new Map<string, number>();
  for (const row of chargerSessionsRes.data ?? []) {
    const r = row as { energy_kwh: number; EV_Chargers: { name: string } | null };
    const name = r.EV_Chargers?.name ?? "Charger";
    byCharger.set(name, (byCharger.get(name) ?? 0) + Number(r.energy_kwh ?? 0));
  }
  const topChargers = [...byCharger.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, kwh]) => `${name}: ${Math.round(kwh * 10) / 10} kWh`);

  const recipients = recipientsRes.data ?? [];
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const r = recipient as { email: string; full_name: string };
    const bodyHtml = `<p>Hello ${r.full_name},</p>
<p>Weekly DFCCIL EV-CMS summary (this week):</p>
<ul>
<li>Total energy: ${Math.round(totalEnergy * 10) / 10} kWh</li>
<li>Completed sessions: ${totalSessions}</li>
<li>Revenue (successful payments): INR ${totalRevenue.toLocaleString("en-IN")}</li>
</ul>
${topChargers.length ? `<p>Top chargers:<br>${topChargers.join("<br>")}</p>` : ""}
<p><a href="https://ev-cms-rho.vercel.app/reports">Open reports</a></p>`;

    const ok = await postEmail(flowUrl, {
      emailType: "weekly_report",
      to: r.email,
      subject: "DFCCIL EV-CMS weekly report — this week",
      body: bodyHtml,
      bodyHtml,
      bodyPlain: `Weekly summary: ${totalEnergy} kWh, ${totalSessions} sessions, INR ${totalRevenue}`,
      isHtml: true,
      source: "ev-cms-reports-cron",
    });
    if (ok) sent += 1;
    else failed += 1;
  }

  return new Response(JSON.stringify({ sent, failed, recipients: recipients.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
