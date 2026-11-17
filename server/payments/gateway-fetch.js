import { Agent, request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { globalsignIntermediate } from "./globalsign-intermediate.js";

// Supply the omitted intermediate only to the DFCCIL gateway. Root trust, expiry,
// signature verification and Node's default hostname verification remain enabled.
const gatewayAgent = new Agent({ ca: [...rootCertificates, globalsignIntermediate], rejectUnauthorized: true, keepAlive: true });
export function createGatewayFetch({ request = httpsRequest, fallback = fetch } = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.origin !== "https://epay.dfccil.com") return fallback(input, init);
    if (url.username || url.password) throw new Error("Gateway URL must not contain credentials");
    const outboundHeaders = new Headers(init.headers);
    outboundHeaders.set("Accept-Encoding", "identity");
    return new Promise((resolve, reject) => {
      const req = request(url, { agent: gatewayAgent, method: init.method || "GET", headers: Object.fromEntries(outboundHeaders), signal: init.signal }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume(); reject(new Error("Gateway redirects are not permitted")); return;
        }
        const chunks = [];
        let length = 0;
        response.on("data", chunk => {
          length += chunk.length;
          if (length > 16 * 1024 * 1024) { response.destroy(new Error("Gateway response exceeds limit")); return; }
          chunks.push(Buffer.from(chunk));
        });
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Gateway response interrupted")));
        response.on("end", () => {
          try {
            const headers = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) value.forEach(v => headers.append(name, v));
              else if (value !== undefined) headers.set(name, value);
            }
            const empty = init.method === "HEAD" || [204, 205, 304].includes(response.statusCode);
            resolve(new Response(empty ? null : Buffer.concat(chunks), { status: response.statusCode, headers }));
          } catch (error) { reject(error); }
        });
      });
      req.on("error", error => {
        // Preserve the transport code in the shape used by payment diagnostics.
        reject(new TypeError("DFCCIL gateway request failed", { cause: error }));
      });
      req.setTimeout(15000, () => req.destroy(new Error("Gateway socket timed out")));
      req.end(init.body);
    });
  };
}
export const gatewayFetch = createGatewayFetch();
