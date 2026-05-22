import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSampleSessions } from "./fixture";
import {
  getRequestDetail,
  getSessionDetail,
  listSessions,
} from "../../src/ui/server/data";
import { handleApi } from "../../src/ui/server/api";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-data-"));
  buildSampleSessions(dir);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listSessions", () => {
  it("summarises the sample session", () => {
    const sessions = listSessions(dir);
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe(1);
    expect(s.requestCount).toBe(4);
    expect(s.conversationCount).toBe(3);
    expect(s.errorCount).toBe(0);
    expect(s.models).toContain("claude-sonnet-4-6");
  });
});

describe("getSessionDetail", () => {
  it("returns entries and the conversation overview", () => {
    const detail = getSessionDetail(dir, 1);
    expect(detail).not.toBeNull();
    expect(detail!.entries).toHaveLength(4);
    expect(detail!.overview).toHaveLength(3);
    expect(detail!.overview[0].conversationId).toBe("root");
    expect(detail!.overview[0].steps).toHaveLength(2);
  });

  it("returns null for an unknown session", () => {
    expect(getSessionDetail(dir, 999)).toBeNull();
  });
});

describe("getRequestDetail", () => {
  it("normalizes a non-streaming request", () => {
    const detail = getRequestDetail(dir, 1, 1);
    expect(detail).not.toBeNull();
    expect(detail!.normalized.system).toHaveLength(1);
    expect(detail!.normalized.tools.map((t) => t.name)).toEqual(["Task", "Read"]);
    expect(detail!.normalized.messages).toHaveLength(1);
    expect(detail!.normalized.response?.blocks.some((b) => b.kind === "tool_use")).toBe(true);
  });

  it("reassembles a streaming response", () => {
    const detail = getRequestDetail(dir, 1, 3);
    expect(detail!.normalized.response?.blocks).toEqual([
      { kind: "text", text: "src/viewer is the CLI viewer." },
    ]);
  });

  it("returns null for an unknown request", () => {
    expect(getRequestDetail(dir, 1, 999)).toBeNull();
  });
});

describe("handleApi", () => {
  it("routes the sessions list", () => {
    const res = handleApi(dir, "/api/sessions");
    expect(res?.status).toBe(200);
    expect(Array.isArray(res?.body)).toBe(true);
  });

  it("404s an unknown session and ignores non-api paths", () => {
    expect(handleApi(dir, "/api/sessions/999")?.status).toBe(404);
    expect(handleApi(dir, "/session/1")).toBeNull();
  });
});
