import { appendFileSync } from "node:fs";
import mobileHandler from "../api/mobile.js";
import { protectedPayment,returnPayment } from "../server/payments/http.js";
import http from "node:http";
import { randomBytes } from "node:crypto";
import handler from "../api/sso.js";

// Reuse server-only credentials locally without copying them into the mobile app.
process.loadEnvFile(new URL("../.env", import.meta.url));
process.env.SUPABASE_URL ||= process.env.VITE_SUPABASE_URL;
if (!process.env.SSO_SESSION_SECRET) {
  process.env.SSO_SESSION_SECRET = randomBytes(48).toString("base64url");
  appendFileSync(new URL("../.env", import.meta.url), `\nSSO_SESSION_SECRET=${process.env.SSO_SESSION_SECRET}\n`);
}
process.env.SSO_ALLOWED_REDIRECT_URIS ||= "in.dfccil.evcms://auth/callback";
// DFCCIL confirmed public mobile client authentication with PKCE S256 and no secret.
process.env.SSO_TOKEN_AUTH_METHOD ||= "none";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Local .env needs SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or VITE_SUPABASE_URL).");
}

const server = http.createServer(async (req, response) => {
  response.setHeader("Cache-Control", "no-store");
  const pathname = new URL(req.url, "http://localhost").pathname;
  const paymentAction = /^\/api\/payments\/dfccil\/(create|status|config|history|receipt|return)$/.exec(pathname)?.[1];
  if (!paymentAction && !["/api/sso", "/api/mobile"].includes(pathname)) { response.writeHead(404).end(); return; }
  const res = {
    setHeader: (key, value) => response.setHeader(key, value),
    status(code) { response.statusCode = code; return this; },
    send(body) { response.end(body); return this; },
    json(body) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); return this; },
  };
  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 7500000) { res.status(413).json({ error: "Request too large" }); return; }
    }
    req.body = raw ? JSON.parse(raw) : {};
    if (paymentAction === "return") await returnPayment(req, res);
    else if (paymentAction) await protectedPayment(req, res, paymentAction);
    else await (pathname === "/api/sso" ? handler : mobileHandler)(req, res);
  } catch {
    if (!response.writableEnded) res.status(400).json({ error: "Invalid request" });
  }
});
server.listen(3001, "127.0.0.1", () => {
  console.log("Local SSO backend: http://127.0.0.1:3001/api/sso");
  console.log("Android emulator: http://10.0.2.2:3001/api/sso");
  console.log("Token authentication:", process.env.SSO_TOKEN_AUTH_METHOD);
  console.log("Session signing key loaded from the server-only local environment.");
});
