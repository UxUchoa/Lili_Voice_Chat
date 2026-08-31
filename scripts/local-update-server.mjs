import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "");
const port = Number(process.argv[3] ?? 8899);
if (!root || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Uso: node local-update-server.mjs <diretório> <porta>");

const mime = {
  ".yml": "text/yaml; charset=utf-8",
  ".exe": "application/octet-stream",
  ".blockmap": "application/octet-stream",
};

const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const relative = pathname.replace(/^\/+/, "");
    const file = resolve(root, relative || "latest.yml");
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY http://127.0.0.1:${port}/\n`);
});

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
