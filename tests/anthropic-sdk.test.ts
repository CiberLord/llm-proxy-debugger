import { describe, it, expect } from "vitest";
import { anthropicSdkBaseUrl, serializeAnthropicSSE } from "../src/server/anthropic-sdk";

describe("anthropicSdkBaseUrl", () => {
  it("strips a trailing /v1 so the SDK can append /v1/messages itself", () => {
    expect(anthropicSdkBaseUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com"
    );
  });

  it("leaves a host-only base URL unchanged", () => {
    expect(anthropicSdkBaseUrl("https://api.anthropic.com")).toBe(
      "https://api.anthropic.com"
    );
  });

  it("tolerates trailing slashes", () => {
    expect(anthropicSdkBaseUrl("https://api.anthropic.com/v1/")).toBe(
      "https://api.anthropic.com"
    );
  });

  it("strips /v1 from a self-hosted gateway path", () => {
    expect(anthropicSdkBaseUrl("https://gw.internal/anthropic/v1")).toBe(
      "https://gw.internal/anthropic"
    );
  });
});

describe("serializeAnthropicSSE", () => {
  it("encodes an event as wire SSE (event line + json data line)", () => {
    expect(serializeAnthropicSSE({ type: "message_stop" })).toBe(
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    );
  });

  it("names the SSE event after the event type", () => {
    const out = serializeAnthropicSSE({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hi" },
    } as { type: string });
    expect(out.startsWith("event: content_block_delta\ndata: ")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(true);
  });
});
