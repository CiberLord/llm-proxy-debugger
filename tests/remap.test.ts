import { describe, it, expect } from "vitest";
import { applyModelRemap } from "../src/server/remap";

describe("applyModelRemap", () => {
  it("returns exact match when present", () => {
    expect(
      applyModelRemap("claude-sonnet-4-6", {
        "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
        "*": "anthropic/claude-opus-4.7",
      })
    ).toBe("anthropic/claude-sonnet-4.6");
  });

  it("matches wildcard patterns", () => {
    const map = {
      "*opus*": "anthropic/claude-opus-4.7",
      "*sonnet*": "anthropic/claude-sonnet-4.6",
      "*haiku*": "anthropic/claude-3.5-haiku",
      "*": "anthropic/claude-sonnet-4.6",
    };
    expect(applyModelRemap("claude-3-opus-20240229", map)).toBe(
      "anthropic/claude-opus-4.7"
    );
    expect(applyModelRemap("claude-3-5-sonnet-20241022", map)).toBe(
      "anthropic/claude-sonnet-4.6"
    );
    expect(applyModelRemap("claude-3-5-haiku-20241022", map)).toBe(
      "anthropic/claude-3.5-haiku"
    );
  });

  it("respects ordering: specific wildcard before generic", () => {
    const map = {
      "*opus-4-7*": "anthropic/claude-opus-4.7",
      "*opus*": "anthropic/claude-opus-fallback",
    };
    expect(applyModelRemap("claude-opus-4-7", map)).toBe(
      "anthropic/claude-opus-4.7"
    );
    expect(applyModelRemap("claude-opus-4-5", map)).toBe(
      "anthropic/claude-opus-fallback"
    );
  });

  it("falls back to *", () => {
    expect(applyModelRemap("totally-unknown-model", { "*": "fallback" })).toBe(
      "fallback"
    );
  });

  it("returns input unchanged when no match and no fallback", () => {
    expect(applyModelRemap("x", { "claude-*": "y" })).toBe("x");
  });

  it("escapes regex metacharacters in literal portions of pattern", () => {
    expect(
      applyModelRemap("model+v1.0", {
        "model+v1.0": "exact",
        "*": "fallback",
      })
    ).toBe("exact");
    expect(applyModelRemap("model+v2.0", { "model+*": "starred" })).toBe(
      "starred"
    );
  });
});
