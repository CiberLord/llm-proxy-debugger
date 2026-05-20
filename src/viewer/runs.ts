import * as fs from "node:fs";
import * as path from "node:path";
import type { IndexEntry } from "../server/index/types";
import { readIndex } from "../server/index/writer";

export interface ResolvedRun {
  sessionId: number;
  sessionDir: string;
  entries: IndexEntry[];
}

export function resolveSessionsDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const envDir = process.env.PROX_SESSIONS_DIR;
  if (envDir) return path.resolve(envDir);
  return path.resolve(process.cwd(), "sessions");
}

export function listRuns(sessionsDir: string): number[] {
  if (!fs.existsSync(sessionsDir)) return [];
  const out: number[] = [];
  for (const e of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const n = Number(e.name);
    if (Number.isFinite(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function resolveRun(sessionsDir: string, runArg: string | undefined): ResolvedRun {
  const runs = listRuns(sessionsDir);
  if (runs.length === 0) {
    throw new Error(`No sessions found in ${sessionsDir}`);
  }
  let runId: number;
  if (!runArg || runArg === "latest") {
    runId = runs[runs.length - 1];
  } else {
    const n = Number(runArg);
    if (!Number.isFinite(n)) throw new Error(`Invalid run id: ${runArg}`);
    if (!runs.includes(n)) throw new Error(`Run ${n} not found in ${sessionsDir}`);
    runId = n;
  }
  const sessionDir = path.join(sessionsDir, String(runId));
  const entries = readIndex(sessionDir);
  return { sessionId: runId, sessionDir, entries };
}

export function readRequestFile(
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
