import { createRemoteJWKSet, jwtVerify } from "jose";
import { authenticate, bearer, database, issueSession, mappedUser, revokeSession } from "../server/sso/sessions.js";
export { verifyApplicationSession } from "../server/sso/sessions.js";

const ISSUER = "https://app2.dfccil.com";
const CLIENT_ID = "f51c3d26cd09487eb2350a9742b8af18";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/openid-configuration/jwks`));

export async function verifyIdentity(token, nonce, keys = jwks) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ISSUER, audience: CLIENT_ID, algorithms: ["RS256"], requiredClaims: ["sub", "iat", "exp", "nonce"], maxTokenAge: "10m", clockTolerance: 5,
  });
  if (payload.nonce !== nonce || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.sub || "")) {
    throw new Error("Invalid identity");
  }
  if ((Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== CLIENT_ID) ||
      (payload.azp !== undefined && payload.azp !== CLIENT_ID)) throw new Error("Invalid authorized party");
  return payload;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const missingVariables = [
    "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "SSO_SESSION_SECRET", "SSO_ALLOWED_REDIRECT_URIS",
  ].filter(name => !process.env[name]?.trim());
  if (missingVariables.length) {
    console.error(JSON.stringify({
      event: "sso_configuration_missing",
      missingVariables,
      deployment: process.env.VERCEL_URL || "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
    }));
    return res.status(503).json({ error: "DFCCIL SSO is not configured. Contact your administrator." });
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Invalid request" });
  try {
    let virtualId;
    if (body.action === "exchange") {
      const { code, codeVerifier, nonce, redirectUri } = body;
      const redirects = process.env.SSO_ALLOWED_REDIRECT_URIS.split(",").map(value => value.trim());
      if (typeof code !== "string" || !code || code.length > 4096 ||
          typeof codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) ||
          typeof nonce !== "string" || nonce.length < 16 || nonce.length > 256 ||
          typeof redirectUri !== "string" || !redirects.includes(redirectUri)) {
        return res.status(400).json({ error: "Invalid SSO callback parameters" });
      }
      const authMethod = process.env.SSO_TOKEN_AUTH_METHOD;
      if (!["none", "client_secret_basic", "client_secret_post"].includes(authMethod) ||
          (authMethod !== "none" && !process.env.SSO_CLIENT_SECRET)) {
        return res.status(503).json({ error: "SSO client authentication is not configured." });
      }
      const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      if (authMethod === "client_secret_basic") {
        headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(process.env.SSO_CLIENT_SECRET)}`).toString("base64")}`;
      } else {
        form.set("client_id", CLIENT_ID);
        if (authMethod === "client_secret_post") form.set("client_secret", process.env.SSO_CLIENT_SECRET);
      }
      const response = await fetch(`${ISSUER}/connect/token`, {
        method: "POST", headers, body: form, signal: AbortSignal.timeout(15000), redirect: "error",
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        const hints = {
          invalid_client: "DFCCIL rejected the client configuration. Confirm public-client PKCE or configure the required server-side client secret.",
          invalid_grant: "DFCCIL rejected the authorization code. Start sign-in again and check the registered callback URL.",
          unauthorized_client: "DFCCIL has not allowed this login flow for EV-CMS.",
        };
        return res.status(401).json({ error: hints[failure.error] || "DFCCIL rejected the sign-in. Please retry or contact your administrator." });
      }
      const tokens = await response.json();
      if (typeof tokens.id_token !== "string") throw new Error("Missing ID token");
      const identity = await verifyIdentity(tokens.id_token, nonce);
      virtualId = identity.sub;
      // No refresh token is requested or retained. Application lifetime cannot exceed the ID token.
      const expiry = Math.min(identity.exp, Math.floor(Date.now() / 1000) + 3600);
      if (expiry <= Math.floor(Date.now() / 1000)) throw new Error("Expired identity");
      const user = await mappedUser(virtualId);
      if (!user) return res.status(403).json({ error: "Your DFCCIL account is not provisioned or active in EV-CMS. Contact your administrator." });
      const session = await issueSession(user, virtualId, expiry);
      if (process.env.SSO_POST_LOGOUT_REDIRECT_URI) {
        const logout = new URL(`${ISSUER}/connect/endsession`);
        logout.search = new URLSearchParams({ id_token_hint: tokens.id_token,
          post_logout_redirect_uri: process.env.SSO_POST_LOGOUT_REDIRECT_URI, client_id: CLIENT_ID }).toString();
        session.providerLogoutUrl = logout.toString();
        session.providerLogoutRedirectUri = process.env.SSO_POST_LOGOUT_REDIRECT_URI;
      }
      return res.status(200).json(session);
    } else if (["session", "logout", "logout-all", "admin-users", "admin-provision", "admin-revoke"].includes(body.action)) {
      const auth = await authenticate(bearer(req));
      if (body.action === "logout" || body.action === "logout-all") {
        await revokeSession(auth, body.action === "logout-all");
        return res.status(200).json({ success: true });
      }
      if (body.action.startsWith("admin-")) {
        if (auth.user.role !== "SuperAdmin") return res.status(403).json({ error: "Administrator access required" });
        const { administer } = await import("../server/sso/administration.js");
        try { return res.status(200).json(await administer(body, auth)); }
        catch (error) { return res.status(400).json({ error: error.message }); }
      }
      return res.status(200).json({ token: auth.token, user: auth.user, expiresAt: auth.expiresAt });
    }
    return res.status(400).json({ error: "Unknown SSO action" });
  } catch {
    // Never return/log authorization codes, tokens, verifiers or provider response bodies.
    return res.status(401).json({ error: "SSO verification failed. Please sign in again or contact your administrator." });
  }
}
