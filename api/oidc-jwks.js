const ISSUER = (process.env.OIDC_ISSUER || process.env.VITE_OIDC_ISSUER || "https://app2.dfccil.com").replace(/\/$/, "");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const upstream = await fetch(`${ISSUER}/.well-known/openid-configuration/jwks`);
  const body = await upstream.text();
  res.status(upstream.status).setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  return res.send(body);
};
