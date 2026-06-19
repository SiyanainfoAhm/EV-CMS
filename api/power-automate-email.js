/**
 * Vercel serverless proxy → Power Automate HTTP trigger.
 * Set POWER_AUTOMATE_EMAIL_URL in Vercel env (full HTTP POST URL from the flow).
 *
 * Power Automate "Send an email (V2)":
 *   To      → triggerBody()?['to']
 *   Subject → triggerBody()?['subject']
 *   Body    → triggerBody()?['body']  (or bodyHtml)
 *   Is HTML → Yes
 */
function enrichEmailPayload(raw) {
  if (!raw || typeof raw !== "object") return raw;

  const bodyHtml = typeof raw.bodyHtml === "string" ? raw.bodyHtml.trim() : "";
  const bodyPlain = typeof raw.bodyPlain === "string" ? raw.bodyPlain : typeof raw.body === "string" ? raw.body : "";

  if (!bodyHtml) return raw;

  return {
    ...raw,
    isHtml: true,
    bodyHtml,
    bodyPlain,
    body: bodyHtml,
  };
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    response.status(200).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  const flowUrl = process.env.POWER_AUTOMATE_EMAIL_URL?.trim();
  if (!flowUrl) {
    response.status(503).json({
      success: false,
      error:
        "POWER_AUTOMATE_EMAIL_URL is not set. Add the Power Automate HTTP POST URL in Vercel → Settings → Environment Variables.",
    });
    return;
  }

  try {
    const upstream = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enrichEmailPayload(request.body ?? {})),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      response.status(upstream.status).json({
        success: false,
        error: text || `Power Automate returned ${upstream.status}`,
      });
      return;
    }

    response.status(202).json({
      success: true,
      message: "Power Automate accepted the request. Check the recipient inbox shortly.",
    });
  } catch (err) {
    response.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Proxy request failed",
    });
  }
}
