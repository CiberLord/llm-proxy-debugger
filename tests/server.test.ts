import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AddressInfo } from "node:net";
import { createServer } from "../src/server/server";
import type { Config } from "../config";

interface MockResponseInit {
  status?: number;
  contentType?: string;
  body: string;
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockSSEResponse(body: string, status = 200): Response {
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
          baseUrl: "https://upstream.test/api/v1",
          provider: "openai-compatible",
          apiKey: "sk-test",
          modelsRemapping: {
            "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
            "*haiku*": "anthropic/claude-3.5-haiku",
            "*": "anthropic/claude-sonnet-4.6",
          },
        },
      },
      openai: {
        local: { baseUrl: "openai/v1" },
        target: {
          baseUrl: "https://upstream.test/api/v1",
          provider: "openai-compatible",
          apiKey: "sk-test",
          modelsRemapping: {
            "glm-4.7": "openai/gpt-4.1",
            "*": "openai/gpt-fallback",
          },
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
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-sessions-"));
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

function readRequestDir(harness: Harness, reqId: number): {
  raw_request: any;
  raw_response: any;
  request: any;
  response: any;
} {
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

/** fetch that bypasses the mock — used by tests to talk to the proxy HTTP server. */
const clientFetch: typeof fetch = (input, init) => realFetch(input as never, init);

describe("anthropic route → OpenAI upstream", () => {
  it("converts request, response, and remaps model", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-sonnet-4.6",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      })
    );

    const res = await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 7, output_tokens: 2 },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://upstream.test/api/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    const upstreamHeaders = (init as RequestInit).headers as Record<string, string>;
    expect(upstreamHeaders["Authorization"]).toBe("Bearer sk-test");
    const upstreamBody = JSON.parse((init as RequestInit).body as string);
    expect(upstreamBody.model).toBe("anthropic/claude-sonnet-4.6");
    expect(upstreamBody.messages).toEqual([{ role: "user", content: "hi" }]);

    const files = readRequestDir(harness, 1);
    expect(files.request.body.model).toBe("claude-sonnet-4-6");
    expect(files.raw_request.body.model).toBe("anthropic/claude-sonnet-4.6");
    expect(files.raw_request.headers.Authorization).toBe("Bearer sk-test");
    expect(files.response.body.content).toEqual([
      { type: "text", text: "Hello!" },
    ]);
  });

  it("treats /messages?beta=true (query string) as messages and converts to /chat/completions", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-sonnet-4.6",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    );

    const res = await clientFetch(
      `${harness.baseUrl}/anthropic/v1/messages?beta=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: "hi" }],
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("message");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://upstream.test/api/v1/chat/completions"
    );
  });

  it("streams Anthropic SSE even when URL has ?beta=true", async () => {
    const sseBody =
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { content: "Hi" } }],
      })}\n\n` +
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })}\n\n` +
      `data: [DONE]\n\n`;
    fetchMock.mockResolvedValueOnce(mockSSEResponse(sseBody));

    const res = await clientFetch(
      `${harness.baseUrl}/anthropic/v1/messages?beta=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          stream: true,
          messages: [{ role: "user", content: "x" }],
        }),
      }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain("event: message_start");

    const files = readRequestDir(harness, 1);
    expect(files.response.body).toMatchObject({
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
    });
  });

  it("uses wildcard mapping for unknown anthropic IDs", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-3.5-haiku",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    );

    await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 8,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    const upstreamBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(upstreamBody.model).toBe("anthropic/claude-3.5-haiku");
  });

  it("propagates upstream non-2xx errors with body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
    );

    const res = await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "x" }],
      }),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "rate_limited" });

    const files = readRequestDir(harness, 1);
    expect(files.response.status).toBe(429);
    expect(files.response.body).toEqual({ error: "rate_limited" });
  });

  it("translates SSE stream and logs both raw and final body", async () => {
    const sseBody =
      `data: ${JSON.stringify({
        id: "x",
        model: "anthropic/claude-sonnet-4.6",
        choices: [{ index: 0, delta: { role: "assistant" } }],
      })}\n\n` +
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { content: "Hi" } }],
      })}\n\n` +
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { content: "!" } }],
      })}\n\n` +
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      })}\n\n` +
      `data: [DONE]\n\n`;

    fetchMock.mockResolvedValueOnce(mockSSEResponse(sseBody));

    const res = await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "say hi" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    const eventLines = text
      .split("\n")
      .filter((l) => l.startsWith("event: "))
      .map((l) => l.slice(7));
    expect(eventLines).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    const files = readRequestDir(harness, 1);
    expect(typeof files.raw_response.body).toBe("string");
    expect(files.raw_response.body).toContain('"choices"'); // raw upstream SSE
    expect(files.response.body.content).toEqual([
      { type: "text", text: "Hi!" },
    ]);
    expect(files.response.body.usage).toEqual({
      input_tokens: 3,
      output_tokens: 2,
    });
  });

  it("checks stream:true upstream request flag", async () => {
    fetchMock.mockResolvedValueOnce(mockSSEResponse("data: [DONE]\n\n"));

    await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stream: true,
        messages: [{ role: "user", content: "x" }],
      }),
    });
    const upstreamBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(upstreamBody.stream).toBe(true);
    expect(upstreamBody.stream_options).toEqual({ include_usage: true });
  });
});

describe("openai route", () => {
  it("forwards as-is, remaps model, replaces auth", async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ id: "x", choices: [], usage: {} })
    );

    const res = await clientFetch(`${harness.baseUrl}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer client-key", // should be replaced
      },
      body: JSON.stringify({
        model: "glm-4.7",
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://upstream.test/api/v1/chat/completions");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    const upstreamBody = JSON.parse((init as RequestInit).body as string);
    expect(upstreamBody.model).toBe("openai/gpt-4.1");
    expect(upstreamBody.messages).toEqual([
      { role: "user", content: "ping" },
    ]);
  });

  it("parses streamed response into structured SSE events in response.json", async () => {
    const sseBody =
      `data: ${JSON.stringify({
        id: "x",
        choices: [{ index: 0, delta: { content: "Hi" } }],
      })}\n\n` +
      `event: custom\ndata: ${JSON.stringify({ foo: "bar" })}\n\n` +
      `data: [DONE]\n\n`;
    fetchMock.mockResolvedValueOnce(mockSSEResponse(sseBody));

    await clientFetch(`${harness.baseUrl}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "glm-4.7",
        stream: true,
        messages: [{ role: "user", content: "x" }],
      }),
    });

    const files = readRequestDir(harness, 1);
    expect(Array.isArray(files.response.body)).toBe(true);
    expect(files.response.body).toEqual([
      {
        data: { id: "x", choices: [{ index: 0, delta: { content: "Hi" } }] },
      },
      { event: "custom", data: { foo: "bar" } },
      { data: "[DONE]" },
    ]);
    // raw_response still keeps the original SSE blob
    expect(typeof files.raw_response.body).toBe("string");
    expect(files.raw_response.body).toContain("data:");
  });

  it("uses wildcard fallback for unknown openai models", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    await clientFetch(`${harness.baseUrl}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "no-such-model", messages: [] }),
    });
    const upstreamBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(upstreamBody.model).toBe("openai/gpt-fallback");
  });
});

describe("routing", () => {
  it("returns 404 for unknown path", async () => {
    const res = await clientFetch(`${harness.baseUrl}/nothing`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves index on GET /", async () => {
    const res = await clientFetch(`${harness.baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("LLM Proxy Gateway");
  });
});

describe("session structure", () => {
  it("increments request counter within a single session", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        mockJsonResponse({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      )
    );

    for (let i = 0; i < 3; i += 1) {
      await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: String(i) }],
        }),
      });
    }

    const dirs = fs
      .readdirSync(path.join(harness.sessionsDir, "1", "requests"))
      .sort();
    expect(dirs).toEqual(["1", "2", "3"]);
    for (const d of dirs) {
      const files = fs
        .readdirSync(path.join(harness.sessionsDir, "1", "requests", d))
        .sort();
      expect(files).toEqual(expect.arrayContaining([
        "raw_request.json",
        "raw_response.json",
        "request.json",
        "response.json",
      ]));
    }
  });
});
