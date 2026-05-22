import * as fs from "node:fs";
import * as path from "node:path";
import { readIndex } from "../../server/index/writer";
import type { IndexEntry } from "../../server/index/types";
import type { MetaJson } from "../../server/timings";
import { buildOverview } from "./overview";
import { normalizeRequest, normalizeResponse } from "./normalize";
import type { RequestDetail, SessionDetail, SessionSummary } from "./types";

/** Numeric session-run directories under the sessions root, ascending. */
function listRuns(sessionsDir: string): number[] {
  if (!fs.existsSync(sessionsDir)) return [];
  const out: number[] = [];
  for (const e of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const n = Number(e.name);
    if (Number.isFinite(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** Read and parse one stored file of a request, or null when absent/invalid. */
function readRequestFile(
  sessionDir: string,
  requestId: number,
  fileName: string
): unknown | null {
  const p = path.join(sessionDir, "requests", String(requestId), fileName);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function uniq(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function sessionDirOf(sessionsDir: string, id: number): string {
  return path.join(sessionsDir, String(id));
}

function summarize(sessionsDir: string, id: number): SessionSummary {
  const entries = readIndex(sessionDirOf(sessionsDir, id));
  const starts = entries.map((e) => e.started_at).filter(Boolean).sort();
  const ends = entries.map((e) => e.ended_at).filter(Boolean).sort();
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const e of entries) {
    tokens.input += e.tokens?.input ?? 0;
    tokens.output += e.tokens?.output ?? 0;
    tokens.cacheRead += e.tokens?.cache_read ?? 0;
    tokens.cacheCreation += e.tokens?.cache_creation ?? 0;
  }
  return {
    id,
    startedAt: starts[0],
    endedAt: ends[ends.length - 1],
    requestCount: entries.length,
    models: uniq(entries.map((e) => e.model_requested)),
    agents: uniq(entries.map((e) => e.client_app_hint ?? e.detection?.detector)),
    tokens,
    errorCount: entries.filter((e) => !!e.error || e.status >= 400).length,
  };
}

/** All sessions, newest first, for the sessions list screen. */
export function listSessions(sessionsDir: string): SessionSummary[] {
  return listRuns(sessionsDir)
    .map((id) => summarize(sessionsDir, id))
    .sort((a, b) => b.id - a.id);
}

/** Full detail of one session: raw index entries plus the conversation tree. */
export function getSessionDetail(
  sessionsDir: string,
  id: number
): SessionDetail | null {
  if (!listRuns(sessionsDir).includes(id)) return null;
  const entries = readIndex(sessionDirOf(sessionsDir, id)).sort(
    (a, b) => a.request_id - b.request_id
  );
  const starts = entries.map((e) => e.started_at).filter(Boolean).sort();
  const ends = entries.map((e) => e.ended_at).filter(Boolean).sort();
  return {
    id,
    startedAt: starts[0],
    endedAt: ends[ends.length - 1],
    entries,
    steps: buildOverview(entries),
  };
}

function bodyOf(file: unknown): unknown {
  return file && typeof file === "object"
    ? (file as Record<string, unknown>).body
    : undefined;
}

/** Normalized + raw view of a single request. */
export function getRequestDetail(
  sessionsDir: string,
  id: number,
  requestId: number
): RequestDetail | null {
  const dir = sessionDirOf(sessionsDir, id);
  const index = readIndex(dir).find((e) => e.request_id === requestId) as
    | IndexEntry
    | undefined;
  if (!index) return null;

  const request = readRequestFile(dir, requestId, "request.json");
  const response = readRequestFile(dir, requestId, "response.json");
  const rawRequest = readRequestFile(dir, requestId, "raw_request.json");
  const rawResponse = readRequestFile(dir, requestId, "raw_response.json");
  const meta = readRequestFile(dir, requestId, "meta.json") as MetaJson | null;

  const nreq = normalizeRequest(index.route, bodyOf(request));
  const nresp = normalizeResponse(index.route, bodyOf(response));

  return {
    sessionId: id,
    index,
    meta,
    normalized: {
      route: index.route,
      model: {
        requested: index.model_requested,
        remappedTo: index.model_remapped_to,
      },
      system: nreq.system,
      tools: nreq.tools,
      messages: nreq.messages,
      response: nresp,
    },
    raw: { request, response, rawRequest, rawResponse },
  };
}
