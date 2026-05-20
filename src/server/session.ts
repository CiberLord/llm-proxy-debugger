import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_SESSIONS_DIR = path.resolve(process.cwd(), "sessions");

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function nextNumericChild(dir: string): number {
  ensureDir(dir);
  let max = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const n = Number(e.name);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export interface RawRequestLog {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface RawResponseLog {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export interface CleanRequestLog {
  url: string;
  body: unknown;
}

export interface CleanResponseLog {
  status: number;
  body: unknown;
}

/**
 * One Session = one server run. Created at startup.
 * Each HTTP request that the proxy handles spawns a RequestLogger
 * which writes into sessions/<id>/requests/<n>/.
 */
export class Session {
  readonly id: number;
  readonly dir: string;
  readonly requestsDir: string;
  private requestCounter = 0;

  constructor(baseDir: string = DEFAULT_SESSIONS_DIR) {
    ensureDir(baseDir);
    this.id = nextNumericChild(baseDir);
    this.dir = path.join(baseDir, String(this.id));
    this.requestsDir = path.join(this.dir, "requests");
    ensureDir(this.requestsDir);
  }

  newRequest(): RequestLogger {
    this.requestCounter += 1;
    return new RequestLogger(this.id, this.requestCounter, this.requestsDir);
  }
}

export class RequestLogger {
  readonly sessionId: number;
  readonly requestId: number;
  readonly dir: string;

  constructor(sessionId: number, requestId: number, requestsDir: string) {
    this.sessionId = sessionId;
    this.requestId = requestId;
    this.dir = path.join(requestsDir, String(requestId));
    ensureDir(this.dir);
  }

  private writeJson(name: string, data: unknown): void {
    fs.writeFileSync(
      path.join(this.dir, name),
      JSON.stringify(data, null, 2)
    );
  }

  writeRawRequest(log: RawRequestLog): void {
    this.writeJson("raw_request.json", log);
  }

  writeRawResponse(log: RawResponseLog): void {
    this.writeJson("raw_response.json", log);
  }

  writeRequest(log: CleanRequestLog): void {
    this.writeJson("request.json", log);
  }

  writeResponse(log: CleanResponseLog): void {
    this.writeJson("response.json", log);
  }
}
