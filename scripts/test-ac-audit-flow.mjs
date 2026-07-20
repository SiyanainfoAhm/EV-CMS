/**
 * Drive AC Test Simulator (MP-AC-TEST-001) audit checks via Supabase + gateway.
 * Web UI audits for Start still need a click on charger detail; this script
 * verifies OCPP connectivity and inserts/toggles that match admin actions
 * when --seed-audits is passed (optional). Prefer clicking the UI.
 *
 * Usage:
 *   node scripts/test-ac-audit-flow.mjs
 *   node scripts/test-ac-audit-flow.mjs --seed-audits
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const CP = "MP-AC-TEST-001";
const preferFly = process.argv.includes("--fly") || process.env.USE_FLY_GATEWAY === "1";
const GATEWAY = (
  preferFly
    ? "https://ev-cms-ocpp-dfccil.fly.dev"
    : process.env.OCPP_GATEWAY_API_URL ||
      process.env.VITE_OCPP_GATEWAY_API_URL ||
      "https://ev-cms-ocpp-dfccil.fly.dev"
).replace(/\/$/, "");
const USER_ID = "a0000001-0000-4000-8000-000000000006"; // Anita Desai
const seedAudits = process.argv.includes("--seed-audits");

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function gatewayJson(path, init) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  console.log(`\n=== AC Test Simulator audit prep (${CP}) ===\n`);

  const status = await gatewayJson(`/ocpp/chargers/${CP}/status`);
  console.log("Gateway status:", status.body);
  if (!status.body?.connected) {
    console.error(
      "\nCharger not connected. Start:\n  cd ocpp-gateway\n  $env:OCPP_GATEWAY_WS='wss://ev-cms-ocpp-dfccil.fly.dev'\n  node scripts/ocpp-test-client.mjs MP-AC-TEST-001\n"
    );
    process.exit(1);
  }

  const { data: charger, error } = await supabase
    .from("EV_Chargers")
    .select("id, charge_point_id, allow_admin_bypass, status")
    .eq("charge_point_id", CP)
    .single();
  if (error) throw error;
  console.log("DB charger:", charger);

  // Ensure bypass OFF for blocked-Start UI test
  if (charger.allow_admin_bypass) {
    await supabase.from("EV_Chargers").update({ allow_admin_bypass: false }).eq("id", charger.id);
    console.log("Set allow_admin_bypass = false");
  }

  if (seedAudits) {
    const rows = [
      {
        user_id: USER_ID,
        action: "Blocked Remote Start",
        entity_type: "Charger",
        entity_id: charger.id,
        details: `RemoteStart blocked — prepaid required (lab bypass off) on ${CP} Gun 1`,
      },
      {
        user_id: USER_ID,
        action: "Enabled Lab Admin Bypass",
        entity_type: "Charger",
        entity_id: charger.id,
        details: `Lab admin bypass enabled on ${CP}`,
      },
      {
        user_id: USER_ID,
        action: "Failed Lab Bypass Remote Start",
        entity_type: "Charger",
        entity_id: charger.id,
        details: `Lab bypass RemoteStart failed on ${CP} Gun 1: simulated failure for audit test`,
      },
    ];
    const { error: insErr } = await supabase.from("EV_AuditLogs").insert(rows);
    if (insErr) throw insErr;
    console.log("Seeded sample audit rows (UI click is still preferred for real proof).");
  }

  const { data: recent } = await supabase
    .from("EV_AuditLogs")
    .select("action, details, created_at")
    .or(
      `action.ilike.%Lab Bypass%,action.ilike.%Blocked Remote%,action.ilike.%Prepaid Plan%,action.ilike.%Lab Admin Bypass%`
    )
    .order("created_at", { ascending: false })
    .limit(12);

  console.log("\nRecent prepaid/bypass audits:");
  for (const row of recent ?? []) {
    console.log(`  • ${row.created_at} | ${row.action} | ${row.details}`);
  }

  console.log(`
UI checklist (http://localhost:3000) — charger ${CP}:
  1) Chargers → AC Test Simulator → Remote Start Gun 1
     → expect Blocked + Audit: "Blocked Remote Start"
  2) Edit → enable Lab admin bypass → Save
     → Audit: "Enabled Lab Admin Bypass"
  3) Remote Start Gun 1 again
     → expect success + Audit: "Lab Bypass Remote Start"
     (to force fail: stop OCPP client first → "Failed Lab Bypass Remote Start")
  4) Prepaid Plans → add/edit/toggle → already logging Created/Updated/Activated
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
