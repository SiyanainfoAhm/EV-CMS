/**
 * One-off: send a test weekly summary email via Power Automate.
 * Usage: node scripts/send-test-weekly-report.mjs [email] [name]
 */
import { readFileSync } from "fs";

const TEST_EMAIL = process.argv[2] ?? "jatin.saksena@siyanainfo.com";
const TEST_NAME = process.argv[3] ?? "Jatin";

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function utcRangeStart(days) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

const env = loadEnv();
const flowUrl = env.POWER_AUTOMATE_EMAIL_URL;
const supabaseUrl = env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!flowUrl) {
  console.error("POWER_AUTOMATE_EMAIL_URL missing in .env");
  process.exit(1);
}
if (!supabaseUrl || !serviceKey) {
  console.error("Supabase URL or SUPABASE_SERVICE_ROLE_KEY missing in .env");
  process.exit(1);
}

const end = new Date();
end.setUTCHours(23, 59, 59, 999);
const start = utcRangeStart(7);
const startIso = start.toISOString();
const endIso = end.toISOString();

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

const [paymentsRes, sessionsRes, chargerSessionsRes] = await Promise.all([
  fetch(
    `${supabaseUrl}/rest/v1/EV_Payments?select=total_amount&status=eq.success&created_at=gte.${encodeURIComponent(startIso)}&created_at=lte.${encodeURIComponent(endIso)}`,
    { headers }
  ),
  fetch(
    `${supabaseUrl}/rest/v1/EV_ChargingSessions?select=id&status=eq.completed&start_time=gte.${encodeURIComponent(startIso)}&start_time=lte.${encodeURIComponent(endIso)}`,
    { headers }
  ),
  fetch(
    `${supabaseUrl}/rest/v1/EV_ChargingSessions?select=energy_kwh,EV_Chargers(name)&status=eq.completed&start_time=gte.${encodeURIComponent(startIso)}&start_time=lte.${encodeURIComponent(endIso)}`,
    { headers: { ...headers, Accept: "application/json" } }
  ),
]);

if (!paymentsRes.ok) throw new Error(`Payments: ${paymentsRes.status} ${await paymentsRes.text()}`);
if (!sessionsRes.ok) throw new Error(`Sessions: ${sessionsRes.status} ${await sessionsRes.text()}`);
if (!chargerSessionsRes.ok) throw new Error(`Charger sessions: ${chargerSessionsRes.status} ${await chargerSessionsRes.text()}`);

const payments = await paymentsRes.json();
const sessions = await sessionsRes.json();
const chargerSessions = await chargerSessionsRes.json();

const totalRevenue = payments.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
const totalSessions = sessions.length;
const totalEnergy = chargerSessions.reduce((sum, row) => sum + Number(row.energy_kwh ?? 0), 0);

const byCharger = new Map();
for (const row of chargerSessions) {
  const name = row.EV_Chargers?.name ?? "Charger";
  byCharger.set(name, (byCharger.get(name) ?? 0) + Number(row.energy_kwh ?? 0));
}
const topChargers = [...byCharger.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([name, kwh]) => `${name}: ${Math.round(kwh * 10) / 10} kWh`);

const energyRounded = Math.round(totalEnergy * 10) / 10;
const revenueFormatted = totalRevenue.toLocaleString("en-IN");

const bodyHtml = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#111;padding:24px">
<h1 style="font-size:20px">DFCCIL EV-CMS — Weekly charging summary (TEST)</h1>
<p>Hello ${TEST_NAME},</p>
<p>Here is your <strong>test</strong> weekly digest for <strong>this week</strong>.</p>
<table style="border-collapse:collapse;margin:16px 0;font-size:14px">
<tr><td style="padding:6px 12px 6px 0;color:#6b7280">Total energy</td><td><strong>${energyRounded} kWh</strong></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#6b7280">Completed sessions</td><td><strong>${totalSessions}</strong></td></tr>
<tr><td style="padding:6px 12px 6px 0;color:#6b7280">Revenue (successful payments)</td><td><strong>INR ${revenueFormatted}</strong></td></tr>
</table>
${topChargers.length ? `<p><strong>Top chargers:</strong><br>${topChargers.join("<br>")}</p>` : "<p>No charger activity this week.</p>"}
<p style="margin-top:24px;font-size:12px;color:#9ca3af">Generated ${new Date().toLocaleString("en-IN")} · Test weekly report from EV-CMS</p>
</body></html>`;

const payload = {
  emailType: "weekly_report",
  to: TEST_EMAIL,
  subject: "DFCCIL EV-CMS weekly report (TEST) — this week",
  body: bodyHtml,
  bodyHtml,
  bodyPlain: `TEST weekly summary: ${energyRounded} kWh, ${totalSessions} sessions, INR ${revenueFormatted}`,
  isHtml: true,
  source: "ev-cms-reports-test",
};

const emailRes = await fetch(flowUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const emailText = await emailRes.text();
if (!emailRes.ok) {
  console.error("Power Automate failed:", emailRes.status, emailText);
  process.exit(1);
}

console.log("Weekly test summary sent to", TEST_EMAIL);
console.log("Stats: energy", energyRounded, "kWh | sessions", totalSessions, "| revenue INR", revenueFormatted);
console.log("Power Automate response:", emailRes.status, emailText || "(empty)");
