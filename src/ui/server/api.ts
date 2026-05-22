import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { getRequestDetail, getSessionDetail, listSessions } from "./data";

export interface UiServerOptions {
  sessionsDir: string;
  /** Directory with the built client (index.html + assets). Optional in dev. */
  clientDir?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** Resolve an /api route to its payload, or null when the route is not an API route. */
export function handleApi(
  sessionsDir: string,
  pathname: string
): { status: number; body: unknown } | null {
  if (!pathname.startsWith("/api/")) return null;

  if (pathname === "/api/sessions") {
    return { status: 200, body: listSessions(sessionsDir) };
  }

  const sessionMatch = /^\/api\/sessions\/(\d+)$/.exec(pathname);
  if (sessionMatch) {
    const detail = getSessionDetail(sessionsDir, Number(sessionMatch[1]));
    return detail
      ? { status: 200, body: detail }
      : { status: 404, body: { error: "session not found" } };
  }

  const requestMatch = /^\/api\/sessions\/(\d+)\/requests\/(\d+)$/.exec(pathname);
  if (requestMatch) {
    const detail = getRequestDetail(
      sessionsDir,
      Number(requestMatch[1]),
      Number(requestMatch[2])
    );
    return detail
      ? { status: 200, body: detail }
      : { status: 404, body: { error: "request not found" } };
  }

  return { status: 404, body: { error: "unknown api route" } };
}

function serveStatic(
  clientDir: string,
  pathname: string,
  res: http.ServerResponse
): void {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(clientDir, rel);
  // Keep resolved paths inside clientDir; fall back to the SPA entry otherwise.
  const indexHtml = path.join(clientDir, "index.html");
  const target =
    filePath.startsWith(clientDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
      ? filePath
      : indexHtml;

  if (!fs.existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("client build not found — run `npm run ui:build:client`");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(target)] ?? "application/octet-stream",
  });
  fs.createReadStream(target).pipe(res);
}

export function createUiServer(opts: UiServerOptions): http.Server {
  return http.createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);

    const api = handleApi(opts.sessionsDir, pathname);
    if (api) {
      sendJson(res, api.status, api.body);
      return;
    }

    if (opts.clientDir) {
      serveStatic(opts.clientDir, pathname, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}
