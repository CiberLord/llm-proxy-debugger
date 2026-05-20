import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AddressInfo } from "node:net";
import { createServer } from "../src/server/server";
import { readIndex } from "../src/server/index/writer";
import type { Config } from "../config";

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
          modelsRemapping: { "*": "anthropic/claude-sonnet-4.6" },
        },
      },
      openai: {
        local: { baseUrl: "openai/v1" },
        target: {
          baseUrl: "https://upstream.test/api/v1",
          provider: "openai-compatible",
          apiKey: "sk-test",
          modelsRemapping: { "*": "openai/gpt-fallback" },
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
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-tim-"));
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

const clientFetch: typeof fetch = (input, init) =>
  realFetch(input as never, init);

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeOpenAIResp(
  content: string,
  tokens = { prompt_tokens: 7, completion_tokens: 2 }
) {
  return {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: "anthropic/claude-sonnet-4.6",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: tokens,
  };
}

describe("server observability", () => {
  it("writes meta.json with monotonic timings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp(makeOpenAIResp("hello")));
    await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    const meta = JSON.parse(
      fs.readFileSync(
        path.join(harness.sessionsDir, "1", "requests", "1", "meta.json"),
        "utf8"
      )
    );
    expect(meta.duration_ms).toBeGreaterThanOrEqual(0);
    const received = Date.parse(meta.received_at);
    const responded = Date.parse(meta.responded_to_client_at);
    expect(responded).toBeGreaterThanOrEqual(received);
    if (meta.upstream_sent_at && meta.upstream_done_at) {
      expect(Date.parse(meta.upstream_done_at)).toBeGreaterThanOrEqual(
        Date.parse(meta.upstream_sent_at)
      );
    }
  });

  it("appends one index.jsonl entry per request with detection info", async () => {
    fetchMock.mockResolvedValueOnce(jsonResp(makeOpenAIResp("a")));
    fetchMock.mockResolvedValueOnce(jsonResp(makeOpenAIResp("b")));

    for (const body of ["first", "second"]) {
      await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "claude-code/9.9.9 (test)",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          system: "be helpful",
          messages: [{ role: "user", content: body }],
        }),
      });
    }

    const entries = readIndex(path.join(harness.sessionsDir, "1"));
    expect(entries).toHaveLength(2);
    expect(entries[0].detection.detector).toBe("claude-code");
    expect(entries[0].conversation_id).not.toBe(entries[1].conversation_id);
    expect(entries[0].tokens.input).toBe(7);
    expect(entries[0].tokens.output).toBe(2);
    expect(entries[0].model_requested).toBe("claude-sonnet-4-6");
    expect(entries[0].model_remapped_to).toBe("anthropic/claude-sonnet-4.6");
  });

  it("uses the same conversation_id for two requests with same system+first user", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResp(makeOpenAIResp("ok"))));

    const send = () =>
      clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          system: "sys",
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
          ],
        }),
      });
    await send();
    await send();

    const entries = readIndex(path.join(harness.sessionsDir, "1"));
    expect(entries).toHaveLength(2);
    expect(entries[0].conversation_id).toBe(entries[1].conversation_id);
  });

  it("links a subagent request to its parent's Task tool_use", async () => {
    // First request: assistant emits Task tool_use with subagent_type.
    fetchMock.mockResolvedValueOnce(
      jsonResp({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-sonnet-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "tc1",
                  type: "function",
                  function: {
                    name: "Task",
                    arguments: JSON.stringify({
                      subagent_type: "code-reviewer",
                      prompt: "review",
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      })
    );
    // Second request: a brand-new conv id (different system) — should be matched to spawn.
    fetchMock.mockResolvedValueOnce(jsonResp(makeOpenAIResp("done")));

    const ua = { "user-agent": "claude-code/1.0", "content-type": "application/json" };
    await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: ua,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        system: "main agent",
        messages: [{ role: "user", content: "do work" }],
      }),
    });
    await clientFetch(`${harness.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      headers: ua,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        system: "you are code-reviewer",
        messages: [{ role: "user", content: "review pls" }],
      }),
    });

    const entries = readIndex(path.join(harness.sessionsDir, "1"));
    expect(entries).toHaveLength(2);
    const [parent, child] = entries;
    expect(parent.assistant_tool_calls.map((c) => c.name)).toContain("Task");
    expect(child.is_subagent).toBe(true);
    expect(child.parent_conversation_id).toBe(parent.conversation_id);
    expect(child.subagent_type).toBe("code-reviewer");
  });
});
