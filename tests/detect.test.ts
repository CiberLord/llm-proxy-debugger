import { describe, it, expect } from "vitest";
import { conversationIdFor } from "../src/server/detect/conversation-id";
import { RunDetectionContext } from "../src/server/detect/context";
import { ClaudeCodeDetector } from "../src/server/detect/claude-code";
import { GenericHeuristicDetector } from "../src/server/detect/heuristic";
import { runDetectors } from "../src/server/detect";
import type { NormalizedRequest } from "../src/server/detect/types";

function req(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  const systemText = overrides.systemText ?? "sys";
  const firstUserText = overrides.firstUserText ?? "hi";
  return {
    route: "anthropic",
    userAgent: overrides.userAgent,
    systemText,
    firstUserText,
    toolNamesDeclared: overrides.toolNamesDeclared ?? [],
    model: overrides.model ?? "claude-sonnet-4-6",
    conversationId: overrides.conversationId ?? conversationIdFor(systemText, firstUserText),
    ...overrides,
  };
}

describe("conversationIdFor", () => {
  it("is stable for same inputs", () => {
    expect(conversationIdFor("a", "b")).toBe(conversationIdFor("a", "b"));
  });
  it("differs when inputs differ", () => {
    expect(conversationIdFor("a", "b")).not.toBe(conversationIdFor("a", "c"));
    expect(conversationIdFor("a", "b")).not.toBe(conversationIdFor("aa", ""));
  });
});

describe("ClaudeCodeDetector", () => {
  const det = new ClaudeCodeDetector();

  it("matches claude-code/ user agents", () => {
    expect(det.match("claude-code/1.2.3 (node)")).toBe(true);
    expect(det.match("CLAUDE-CODE/x")).toBe(true);
    expect(det.match("Mozilla/5.0")).toBe(false);
    expect(det.match(undefined)).toBe(false);
  });

  it("returns root conversation with strong confidence on first request", () => {
    const ctx = new RunDetectionContext(() => 1000);
    const r = req({ userAgent: "claude-code/1.0" });
    ctx.touchConversation(r.conversationId);
    const result = det.detect(r, ctx);
    expect(result.is_subagent).toBe(false);
    expect(result.confidence).toBe("strong");
    expect(result.parent_conversation_id).toBeUndefined();
  });

  it("links a new conversation to a parent's Task spawn", () => {
    const ctx = new RunDetectionContext(() => 1000);
    const parent = req({ userAgent: "claude-code/1.0", firstUserText: "parent task" });
    ctx.touchConversation(parent.conversationId);
    ctx.registerPendingSpawn(parent.conversationId, "code-reviewer");

    const child = req({ userAgent: "claude-code/1.0", firstUserText: "child task" });
    ctx.touchConversation(child.conversationId);
    const result = det.detect(child, ctx);
    expect(result.is_subagent).toBe(true);
    expect(result.parent_conversation_id).toBe(parent.conversationId);
    expect(result.subagent_type).toBe("code-reviewer");
    expect(result.signals).toContain("parent-emitted-task");
  });

  it("does not link the parent to its own next request", () => {
    const ctx = new RunDetectionContext(() => 1000);
    const parent = req({ userAgent: "claude-code/1.0", firstUserText: "parent" });
    ctx.touchConversation(parent.conversationId);
    ctx.registerPendingSpawn(parent.conversationId, "x");
    const result = det.detect(parent, ctx); // same convId — must not match
    expect(result.is_subagent).toBe(false);
  });
});

describe("GenericHeuristicDetector", () => {
  it("marks weak subagent when a sibling conv is active", () => {
    const det = new GenericHeuristicDetector();
    const ctx = new RunDetectionContext(() => 1000);
    const a = req({ firstUserText: "a" });
    const b = req({ firstUserText: "b" });
    ctx.touchConversation(a.conversationId);
    ctx.touchConversation(b.conversationId);
    const r = det.detect(b, ctx);
    expect(r.is_subagent).toBe(true);
    expect(r.confidence).toBe("weak");
  });
});

describe("runDetectors", () => {
  it("dispatches to ClaudeCodeDetector on UA match, falls back to heuristic otherwise", () => {
    const ctx = new RunDetectionContext(() => 1000);
    const cc = req({ userAgent: "claude-code/1" });
    ctx.touchConversation(cc.conversationId);
    expect(runDetectors(cc, ctx).detector).toBe("claude-code");

    const other = req({ userAgent: "openai-python" });
    ctx.touchConversation(other.conversationId);
    expect(runDetectors(other, ctx).detector).toBe("heuristic");
  });
});
