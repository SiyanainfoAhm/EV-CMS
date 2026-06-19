import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Ensure Power Automate receives HTML in `body` when flows only map that field. */
function enrichEmailPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const payload = raw as Record<string, unknown>;
  const bodyHtml = typeof payload.bodyHtml === "string" ? payload.bodyHtml.trim() : "";
  const bodyPlain =
    typeof payload.bodyPlain === "string"
      ? payload.bodyPlain
      : typeof payload.body === "string"
        ? payload.body
        : "";

  if (!bodyHtml) return raw;

  return {
    ...payload,
    isHtml: true,
    bodyHtml,
    bodyPlain,
    body: bodyHtml,
  };
}

/** Local dev proxy for Power Automate (avoids browser CORS). */
export function powerAutomateProxyPlugin(): Plugin {
  let flowUrl = "";

  return {
    name: "power-automate-proxy",
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), "");
      flowUrl =
        env.POWER_AUTOMATE_EMAIL_URL?.trim() ||
        env.VITE_POWER_AUTOMATE_EMAIL_URL?.trim() ||
        "";
    },
    configureServer(server) {
      const handlePowerAutomate = async (
        req: IncomingMessage,
        res: ServerResponse
      ) => {
        const resolvedUrl =
          flowUrl ||
          process.env.POWER_AUTOMATE_EMAIL_URL?.trim() ||
          process.env.VITE_POWER_AUTOMATE_EMAIL_URL?.trim();

        if (!resolvedUrl) {
          sendJson(res, 503, {
            success: false,
            error:
              "Set POWER_AUTOMATE_EMAIL_URL or VITE_POWER_AUTOMATE_EMAIL_URL in .env (Power Automate HTTP POST URL).",
          });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const upstream = await fetch(resolvedUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(enrichEmailPayload(body)),
          });
          const text = await upstream.text();

          if (!upstream.ok) {
            sendJson(res, upstream.status, {
              success: false,
              error: text || `Power Automate returned ${upstream.status}`,
            });
            return;
          }

          sendJson(res, 202, {
            success: true,
            message: "Power Automate accepted the request. Check the recipient inbox shortly.",
          });
        } catch (err) {
          sendJson(res, 500, {
            success: false,
            error: err instanceof Error ? err.message : "Proxy request failed",
          });
        }
      };

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || !req.url) {
          next();
          return;
        }

        const path = req.url.split("?")[0];
        if (path === "/api/power-automate/email" || path === "/api/power-automate/test-email") {
          await handlePowerAutomate(req, res);
          return;
        }

        next();
      });
    },
  };
}
