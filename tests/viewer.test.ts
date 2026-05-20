import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { IndexWriter } from "../src/server/index/writer";
import type { IndexEntry } from "../src/server/index/types";
import { resolveSessionsDir, resolveRun, listRuns } from "../src/viewer/runs";
import { cmdList } from "../src/viewer/commands/list";
import { cmdShow } from "../src/viewer/commands/show";
import { cmdTree } from "../src/viewer/commands/tree";
import { cmdTimeline } from "../src/viewer/commands/timeline";

let sessionsDir: string;

function entry(overrides: Partial<IndexEntry>): IndexEntry {
  return {
    request_id: overrides.request_id ?? 1,
    route: overrides.route ?? "anthropic",
    endpoint: overrides.endpoint ?? "/messages",
    started_at: overrides.started_at ?? "2024-01-01T00:00:00.000Z",
    ended_at: overrides.ended_at ?? "2024-01-01T00:00:01.000Z",
    duration_ms: overrides.duration_ms ?? 1000,
    ttfb_ms: overrides.ttfb_ms,
    status: overrides.status ?? 200,
    stream: overrides.stream ?? false,
    model_requested: overrides.model_requested ?? "claude-sonnet-4-6",
    model_remapped_to: overrides.model_remapped_to ?? "anthropic/claude-sonnet-4.6",
    user_agent: overrides.user_agent,
    client_app_hint: overrides.client_app_hint,
    tokens: overrides.tokens ?? { input: 10, output: 5 },
    conversation_id: overrides.conversation_id ?? "aaaa1111".repeat(5),
    parent_conversation_id: overrides.parent_conversation_id,
    is_subagent: overrides.is_subagent ?? false,
    subagent_type: overrides.subagent_type,
    detection: overrides.detection ?? {
      confidence: "strong",
      signals: [],
      detector: "claude-code",
    },
    first_user_snippet: overrides.first_user_snippet ?? "hello world",
    assistant_tool_calls: overrides.assistant_tool_calls ?? [],
    concurrency_at_start: overrides.concurrency_at_start ?? 0,
  };
}

beforeEach(() => {
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "view-"));
  const runDir = path.join(sessionsDir, "1");
  fs.mkdirSync(path.join(runDir, "requests", "1"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "requests", "2"), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "requests", "1", "meta.json"),
    JSON.stringify({ duration_ms: 1000 }, null, 2)
  );
  fs.writeFileSync(
    path.join(runDir, "requests", "1", "request.json"),
    JSON.stringify({ body: { model: "claude-sonnet-4-6" } })
  );
  fs.writeFileSync(
    path.join(runDir, "requests", "1", "response.json"),
    JSON.stringify({ body: "ok" })
  );

  const w = new IndexWriter(runDir);
  w.append(
    entry({
      request_id: 1,
      conversation_id: "p".repeat(40),
      started_at: "2024-01-01T00:00:00.000Z",
      ended_at: "2024-01-01T00:00:01.000Z",
      duration_ms: 1000,
    })
  );
  w.append(
    entry({
      request_id: 2,
      conversation_id: "c".repeat(40),
      parent_conversation_id: "p".repeat(40),
      is_subagent: true,
      subagent_type: "code-reviewer",
      started_at: "2024-01-01T00:00:00.500Z",
      ended_at: "2024-01-01T00:00:02.000Z",
      duration_ms: 1500,
      first_user_snippet: "review this",
    })
  );
});

afterEach(() => {
  fs.rmSync(sessionsDir, { recursive: true, force: true });
});

describe("viewer.runs", () => {
  it("resolves the latest run by default", () => {
    const run = resolveRun(sessionsDir, undefined);
    expect(run.sessionId).toBe(1);
    expect(run.entries.length).toBe(2);
  });

  it("listRuns returns sorted run ids", () => {
    fs.mkdirSync(path.join(sessionsDir, "3"));
    expect(listRuns(sessionsDir)).toEqual([1, 3]);
  });

  it("respects PROX_SESSIONS_DIR env", () => {
    const prev = process.env.PROX_SESSIONS_DIR;
    process.env.PROX_SESSIONS_DIR = sessionsDir;
    try {
      expect(resolveSessionsDir()).toBe(path.resolve(sessionsDir));
    } finally {
      if (prev === undefined) delete process.env.PROX_SESSIONS_DIR;
      else process.env.PROX_SESSIONS_DIR = prev;
    }
  });
});

describe("viewer commands", () => {
  it("list prints request rows", () => {
    const run = resolveRun(sessionsDir, undefined);
    const out = cmdList(run);
    expect(out).toContain("Session #1");
    expect(out).toMatch(/#?\s*1/);
    expect(out).toMatch(/claude-sonn/);
    expect(out).toContain("subagent:code-reviewer");
  });

  it("show prints meta/request/response and index entry", () => {
    const run = resolveRun(sessionsDir, undefined);
    const out = cmdShow(run, "1");
    expect(out).toContain("# index entry");
    expect(out).toContain("# meta.json");
    expect(out).toContain("# request.json");
    expect(out).toContain("# response.json");
  });

  it("tree groups parent and child convos", () => {
    const run = resolveRun(sessionsDir, undefined);
    const out = cmdTree(run);
    expect(out).toContain("root (claude-code)");
    expect(out).toContain("subagent:code-reviewer");
    expect(out).toMatch(/└─/);
  });

  it("timeline draws bars", () => {
    const run = resolveRun(sessionsDir, undefined);
    const out = cmdTimeline(run);
    expect(out).toContain("timeline");
    expect(out).toContain("█");
    expect(out).toContain("#1");
    expect(out).toContain("#2");
  });
});
