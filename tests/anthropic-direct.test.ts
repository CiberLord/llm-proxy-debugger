/**
 * Tests for the direct Anthropic provider (provider: "anthropic").
 *
 * The proxy talks to the real Anthropic Messages API via the official
 * @anthropic-ai/sdk. `globalThis.fetch` is stubbed so the proxy's SDK call
 * never leaves the process; the stub returns canonical Anthropic API payloads.
 * Test clients use `realFetch` to reach the proxy HTTP server, bypassing the
 * stub — the same harness pattern as tests/server.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { createServer } from "../src/server/server";
import type { Config } from "../config";

// ── canonical Anthropic Messages API payloads ──────────────────────────────

/** A non-streaming Message response, in the real Messages API shape. */
function anthropicMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_01XFDUDYJgAACzvnptvVoYEL",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-20250514",
    content: [{ type: "text", text: "Hello from Claude!" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 7 },
    ...overrides,
  };
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The canonical SSE event sequence for a streamed text response. */
function mockAnthropicSSE(): Response {
  const events = [
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_stream_01",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-20250514",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 15, output_tokens: 1 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    { event: "ping", data: { type: "ping" } },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: ", world!" },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 9 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
  const body = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

// ── harness ────────────────────────────────────────────────────────────────

function makeConfig(): Config {
  return {
    proxy: {
      port: 0,
      anthropic: {
        local: { baseUrl: "anthropic/v1" },
        target: {
          baseUrl: "https://api.anthropic.com/v1",
          provider: "anthropic",
          apiKey: "sk-ant-test",
          modelsRemapping: {},
        },
      },
      openai: {
        local: { baseUrl: "openai/v1" },
        target: {
          baseUrl: "https://upstream.test/v1",
          provider: "openai-compatible",
          apiKey: "sk-openai-test",
          modelsRemapping: { "*": "openai/gpt-4.1" },
        },
      },
    },
  };
}

interface Harness {
  baseUrl: string;
  sessionsDir: string;
  close(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "anthropic-direct-"));
  const server = createServer(makeConfig(), { sessionsDir, quiet: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sessionsDir,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    },
  };
}

function readRequestDir(
  harness: Harness,
  reqId: number
): { raw_request: any; raw_response: any; request: any; response: any } {
  const base = path.join(harness.sessionsDir, "1", "requests", String(reqId));
  const read = (n: string) =>
    JSON.parse(fs.readFileSync(path.join(base, n), "utf8"));
  return {
    raw_request: read("raw_request.json"),
    raw_response: read("raw_response.json"),
    request: read("request.json"),
    response: read("response.json"),
  };
}

let harness: Harness;
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch.bind(globalThis);

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  harness = await startHarness();
});

afterEach(async () => {
  await harness.close();
  vi.unstubAllGlobals();
});

/** fetch that bypasses the mock — used to talk to the proxy HTTP server. */
const clientFetch: typeof fetch = (input, init) => realFetch(input as never, init);

function callHeaders(call: unknown[]): Headers {
  return new Headers((call[1] as RequestInit).headers as HeadersInit);
}

function callBody(call: unknown[]): any {
  return JSON.parse((call[1] as RequestInit).body as string);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("anthropic provider (direct) → Anthropic Messages API", () => {
  it("forwards a non-streaming request directly, unchanged, to /v1/messages", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(anthropicMessage()));

    const res = await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "client-key",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Comes straight back in Anthropic format — no conversion.
    expect(body).toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello from Claude!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    // The proxy's SDK hit the real Anthropic Messages endpoint.
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toBe("https://api.anthropic.com/v1/messages");
    expect((call[1] as RequestInit).method).toBe("POST");

    // Direct Anthropic auth: x-api-key (the configured key), not Bearer.
    const headers = callHeaders(call);
    expect(headers.get("x-api-key")).toBe("sk-ant-test");
    expect(headers.get("anthropic-version")).toBeTruthy();
    expect(headers.get("authorization")).toBeNull();

    // Body forwarded verbatim (Anthropic shape, model not remapped).
    const upstream = callBody(call);
    expect(upstream.model).toBe("claude-opus-4-20250514");
    expect(upstream.max_tokens).toBe(64);
    expect(upstream.messages).toEqual([{ role: "user", content: "hi" }]);

    const files = readRequestDir(harness, 1);
    expect(files.response.body.content).toEqual([
      { type: "text", text: "Hello from Claude!" },
    ]);
    expect(files.raw_request.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("streams a direct Anthropic SSE response and reconstructs the final message", async () => {
    fetchMock.mockResolvedValueOnce(mockAnthropicSSE());

    const res = await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const text = await res.text();
    const eventTypes = text
      .split("\n")
      .filter((l) => l.startsWith("event: "))
      .map((l) => l.slice(7));
    expect(eventTypes).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(text).toContain('"text":"Hello"');

    // Upstream received a streaming request.
    expect(callBody(fetchMock.mock.calls[0]).stream).toBe(true);

    // The SDK reconstructs the final message for the session log + index.
    const files = readRequestDir(harness, 1);
    expect(files.response.body.content[0]).toMatchObject({
      type: "text",
      text: "Hello, world!",
    });
    expect(files.response.body.stop_reason).toBe("end_turn");
    expect(files.response.body.usage.output_tokens).toBe(9);
    expect(typeof files.raw_response.body).toBe("string");
    expect(files.raw_response.body).toContain("event: message_start");
  });

  it("passes Anthropic API errors through with the original status", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse(
        {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        },
        401
      )
    );

    const res = await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      type: "error",
      error: { type: "authentication_error" },
    });

    const files = readRequestDir(harness, 1);
    expect(files.response.status).toBe(401);
  });

  it("works end-to-end with the official Anthropic SDK as the client", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse(
        anthropicMessage({ content: [{ type: "text", text: "SDK roundtrip ok" }] })
      )
    );

    const client = new Anthropic({
      apiKey: "client-key",
      baseURL: `${harness.baseUrl}/anthropic`,
      fetch: realFetch as never,
      maxRetries: 0,
    });

    const message = await client.messages.create({
      model: "claude-opus-4-20250514",
      max_tokens: 64,
      messages: [{ role: "user", content: "ping" }],
    });

    expect(message.role).toBe("assistant");
    expect(message.content).toEqual([
      { type: "text", text: "SDK roundtrip ok" },
    ]);
    expect(message.stop_reason).toBe("end_turn");

    // proxy → upstream still reached the real Anthropic endpoint
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.anthropic.com/v1/messages"
    );
  });
});
