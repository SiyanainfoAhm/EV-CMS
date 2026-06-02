import type { Plugin } from "vite";
import { mkdir, writeFile, stat, readdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const uploadsRoot = join(rootDir, "uploads");

function contentType(fileName: string): string {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  if (fileName.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export function evMediaUploadPlugin(): Plugin {
  return {
    name: "ev-media-upload",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/uploads/")) {
          next();
          return;
        }
        const rel = decodeURIComponent(req.url.replace("/uploads/", ""));
        const filePath = normalize(join(uploadsRoot, rel));
        if (!filePath.startsWith(uploadsRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        try {
          await stat(filePath);
          res.setHeader("Content-Type", contentType(filePath));
          createReadStream(filePath).pipe(res);
        } catch {
          next();
        }
      });

      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/ev-media\/([0-9a-f-]{36})$/i);
        if (!match || (req.method !== "POST" && req.method !== "DELETE")) {
          next();
          return;
        }

        const userId = match[1];

        if (req.method === "DELETE") {
          try {
            const userDir = join(uploadsRoot, "EV", userId);
            const files = await readdir(userDir).catch(() => []);
            await Promise.all(
              files
                .filter((f) => /^avatar\.(jpg|jpeg|png|webp|gif)$/i.test(f))
                .map((f) => unlink(join(userDir, f)).catch(() => undefined))
            );
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              data: string;
              fileName: string;
            };
            if (!body.data || !body.fileName) {
              res.statusCode = 400;
              res.end("Missing data or fileName");
              return;
            }
            const userDir = join(uploadsRoot, "EV", userId);
            await mkdir(userDir, { recursive: true });
            const dest = join(userDir, body.fileName);
            await writeFile(dest, Buffer.from(body.data, "base64"));
            const url = `/uploads/EV/${userId}/${body.fileName}`;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ url, path: `EV/${userId}/${body.fileName}` }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}
