/**
 * End-to-end tests: real SDK clients → live proxy server → mocked upstream.
 *
 * The proxy HTTP server runs on a random port. globalThis.fetch is stubbed so
 * upstream calls never reach the network. SDK clients use the saved `realFetch`
 * to reach the proxy, bypassing the stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import OpenAI from "openai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AddressInfo } from "node:net";
import { createServer } from "../src/server/server";
import type { Config } from "../config";

// ── helpers ────────────────────────────────────────────────────────────────

function mockJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockSSE(lines: string[], status = 200): Response {
  const body = lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function makeConfig(): Config {
  return {
    proxy: {
      port: 0,
      anthropic: {
        local: { baseUrl: "anthropic/v1" },
        target: {
          baseUrl: "https://upstream.test/v1",
          provider: "openai-compatible",
          apiKey: "sk-upstream-test",
          modelsRemapping: {
            "*sonnet*": "anthropic/claude-sonnet-4.6",
            "*haiku*": "anthropic/claude-3.5-haiku",
            "*": "anthropic/claude-sonnet-4.6",
          },
        },
      },
      openai: {
        local: { baseUrl: "openai/v1" },
        target: {
          baseUrl: "https://upstream.test/v1",
          provider: "openai-compatible",
          apiKey: "sk-upstream-test",
          modelsRemapping: {
            "*": "openai/gpt-4.1",
          },
        },
      },
    },
  };
}

interface Harness {
  baseUrl: string;
  close(): Promise<void>;
}

const realFetch = globalThis.fetch.bind(globalThis);
let fetchMock: ReturnType<typeof vi.fn>;
let harness: Harness;

async function startHarness(): Promise<Harness> {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-sessions-"));
  const server = createServer(makeConfig(), { sessionsDir, quiet: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    },
  };
}

function openaiClient(): OpenAI {
  return new OpenAI({
    baseURL: `${harness.baseUrl}/openai/v1`,
    apiKey: "client-key",
    fetch: realFetch as typeof globalThis.fetch,
  });
}

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  harness = await startHarness();
});

afterEach(async () => {
  await harness.close();
  vi.unstubAllGlobals();
});

// ── OpenAI SDK → OpenAI route ──────────────────────────────────────────────

describe("OpenAI SDK → OpenAI route", () => {
  it("completes a chat request and returns the assistant message", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 1700000000,
        model: "openai/gpt-4.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello, world!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
      })
    );

    const completion = await openaiClient().chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "Say hello" }],
    });

    // SDK-level assertions
    expect(completion.choices[0].message.content).toBe("Hello, world!");
    expect(completion.choices[0].finish_reason).toBe("stop");
    expect(completion.usage?.total_tokens).toBe(9);

    // Upstream call assertions
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://upstream.test/v1/chat/completions");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-upstream-test"
    );
    const upstream = JSON.parse(init.body as string);
    expect(upstream.model).toBe("openai/gpt-4.1");
    expect(upstream.messages[0]).toEqual({ role: "user", content: "Say hello" });
  });

  it("streams chat completion tokens via SDK async iterator", async () => {
    fetchMock.mockResolvedValueOnce(
      mockSSE([
        JSON.stringify({ id: "x", choices: [{ index: 0, delta: { role: "assistant" } }] }),
        JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "Hello" } }] }),
        JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "!" } }] }),
        JSON.stringify({
          id: "x",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        "[DONE]",
      ])
    );

    const stream = openaiClient().chat.completions.stream({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });

    const tokens: string[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) tokens.push(delta);
    }

    expect(tokens.join("")).toBe("Hello!");

    const upstream = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(upstream.stream).toBe(true);
  });

  it("propagates upstream 429 as-is through the SDK", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "rate limited", type: "rate_limit_error" } }),
        { status: 429, headers: { "content-type": "application/json" } }
      )
    );

    await expect(
      openaiClient().chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "x" }],
      })
    ).rejects.toThrow();
  });
});

// ── Raw HTTP → Anthropic route ─────────────────────────────────────────────

describe("Anthropic route via HTTP", () => {
  async function anthropicPost(body: unknown): Promise<Response> {
    return realFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "client-key",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  }

  it("converts request to OpenAI format, converts response back to Anthropic format", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJson({
        id: "chatcmpl-2",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-sonnet-4.6",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hi there" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      })
    );

    const res = await anthropicPost({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Must come back in Anthropic format
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content).toEqual([{ type: "text", text: "Hi there" }]);
    expect(body.stop_reason).toBe("end_turn");
    expect(body.usage).toEqual({ input_tokens: 8, output_tokens: 3 });
    expect(body.model).toBe("claude-sonnet-4-6");

    // Upstream got OpenAI-format request with injected auth
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://upstream.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-upstream-test");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["anthropic-version"]).toBeUndefined();
    const upstream = JSON.parse(init.body as string);
    expect(upstream.model).toBe("anthropic/claude-sonnet-4.6");
    expect(upstream.messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("returns Anthropic SSE stream when stream:true", async () => {
    fetchMock.mockResolvedValueOnce(
      mockSSE([
        JSON.stringify({ id: "x", choices: [{ index: 0, delta: { role: "assistant" } }] }),
        JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "Hey" } }] }),
        JSON.stringify({
          id: "x",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
        "[DONE]",
      ])
    );

    const res = await anthropicPost({
      model: "claude-sonnet-4-6",
      max_tokens: 32,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const text = await res.text();

    // Must contain Anthropic SSE event types
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");

    // Content should be "Hey"
    expect(text).toContain('"text":"Hey"');
  });

  it("propagates upstream errors with original status code", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_api_key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );

    const res = await anthropicPost({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "x" }],
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_api_key");
  });
});
