import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { IndexWriter, readIndex } from "../src/server/index/writer";
import type { IndexEntry } from "../src/server/index/types";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "idx-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeEntry(id: number): IndexEntry {
  return {
    request_id: id,
    route: "anthropic",
    endpoint: "/messages",
    status: 200,
    stream: false,
    model_requested: "claude-sonnet-4-6",
    model_remapped_to: "anthropic/claude-sonnet-4.6",
    tokens: { input: 10, output: 5 },
    conversation_id: "abc",
    is_subagent: false,
    detection: { confidence: "strong", signals: [], detector: "claude-code" },
    first_user_snippet: "hi",
    assistant_tool_calls: [],
    concurrency_at_start: 0,
  };
}

describe("IndexWriter", () => {
  it("appends JSONL entries that round-trip through readIndex", () => {
    const w = new IndexWriter(dir);
    w.append(makeEntry(1));
    w.append(makeEntry(2));
    w.append(makeEntry(3));

    const raw = fs.readFileSync(path.join(dir, "index.jsonl"), "utf8");
    expect(raw.split("\n").filter(Boolean).length).toBe(3);

    const back = readIndex(dir);
    expect(back).toHaveLength(3);
    expect(back.map((e) => e.request_id)).toEqual([1, 2, 3]);
  });

  it("returns empty array when no index file", () => {
    expect(readIndex(dir)).toEqual([]);
  });

  it("skips malformed lines", () => {
    const w = new IndexWriter(dir);
    w.append(makeEntry(1));
    fs.appendFileSync(path.join(dir, "index.jsonl"), "garbage not json\n");
    w.append(makeEntry(2));
    const entries = readIndex(dir);
    expect(entries.map((e) => e.request_id)).toEqual([1, 2]);
  });
});
