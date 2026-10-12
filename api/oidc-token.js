const ISSUER = (process.env.OIDC_ISSUER || process.env.VITE_OIDC_ISSUER || "https://app2.dfccil.com").replace(/\/$/, "");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const upstream = await fetch(`${ISSUER}/connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(req.body || {}).toString(),
    });
    const body = await upstream.text();
    res.status(upstream.status).setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    return res.send(body);
  } catch (error) {
    return res.status(502).json({ error: "oidc_upstream_unavailable", error_description: error.message });
  }
};
