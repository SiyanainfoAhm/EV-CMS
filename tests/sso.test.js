import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import handler, { verifyIdentity, verifyApplicationSession } from "../api/sso.js";

const issuer = "https://app2.dfccil.com";
const audience = "f51c3d26cd09487eb2350a9742b8af18";
const subject = "cdab677d-fa11-480b-baf7-6806ade66186";
const nonce = "a-login-specific-nonce";
const keys = await generateKeyPair("RS256");

async function idToken(overrides = {}, signingKey = keys.privateKey) {
  return new SignJWT({ sub: subject, nonce, iss: issuer, aud: audience,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...overrides })
    .setProtectedHeader({ alg: "RS256" }).sign(signingKey);
}

test("accepts the expected signed identity", async () => {
  assert.equal((await verifyIdentity(await idToken(), nonce, keys.publicKey)).sub, subject);
});

for (const [name, overrides] of [
  ["wrong issuer", { iss: "https://other.example" }],
  ["wrong audience", { aud: "other-client" }],
  ["expired token", { exp: 1 }],
  ["future issued-at", { iat: Math.floor(Date.now() / 1000) + 3600 }],
  ["future not-before", { nbf: Math.floor(Date.now() / 1000) + 3600 }],
  ["wrong nonce", { nonce: "another-login" }],
  ["missing nonce", { nonce: undefined }],
  ["invalid subject", { sub: "employee-code" }],
  ["wrong authorized party", { azp: "other-client" }],
  ["multiple audiences without authorized party", { aud: [audience, "other-client"] }],
]) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(verifyIdentity(await idToken(overrides), nonce, keys.publicKey));
  });
}

test("rejects a token signed by another key", async () => {
  const other = await generateKeyPair("RS256");
  await assert.rejects(verifyIdentity(await idToken({}, other.privateKey), nonce, keys.publicKey));
});

test("application session requires its own signature and audience", async () => {
  const key = new TextEncoder().encode("test-secret-for-application-session-only");
  const token = await new SignJWT({ virtualId: subject }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("ev-cms-sso").setAudience("ev-cms-mobile").setSubject("local-user-id")
    .setJti("a-server-session-id").setIssuedAt().setExpirationTime("5m").sign(key);
  assert.equal((await verifyApplicationSession(token, key)).sub, "local-user-id");
  await assert.rejects(verifyApplicationSession(token, new TextEncoder().encode("another-key")));
  await assert.rejects(verifyApplicationSession(await idToken(), key));
});

test("endpoint rejects unsupported methods without contacting provider", async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "GET" }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("configuration diagnostics identify missing names without exposing values", async () => {
  const names = ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SSO_SESSION_SECRET", "SSO_ALLOWED_REDIRECT_URIS"];
  const previous = names.map(name => process.env[name]);
  const originalError = console.error;
  const logs = [];
  try {
    for (const name of names) process.env[name] = "private-test-value";
    delete process.env.SSO_SESSION_SECRET;
    console.error = message => logs.push(message);
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: "POST", body: { action: "session" } }, res);
    assert.equal(res.code, 503);
    assert.equal(logs.length, 1);
    const diagnostic = JSON.parse(logs[0]);
    assert.equal(diagnostic.event, "sso_configuration_missing");
    assert.equal(diagnostic.environment, process.env.VERCEL_ENV || "local");
    assert.deepEqual(diagnostic.missingVariables, ["SSO_SESSION_SECRET"]);
    assert(!logs[0].includes("private-test-value"));
    assert(!JSON.stringify(res.body).includes("SSO_SESSION_SECRET"));
  } finally {
    console.error = originalError;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
