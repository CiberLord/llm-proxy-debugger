import * as fs from "node:fs";
import * as path from "node:path";
import type { IndexEntry } from "../../src/server/index/types";

interface RequestFixture {
  index: IndexEntry;
  request: unknown;
  response: unknown;
  rawRequest?: unknown;
  rawResponse?: unknown;
  meta?: unknown;
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const TASK_TOOL = {
  name: "Task",
  description: "Spawn a subagent to research the codebase.",
  input_schema: {
    type: "object",
    properties: {
      subagent_type: { type: "string" },
      prompt: { type: "string" },
    },
    required: ["subagent_type", "prompt"],
  },
};

const READ_TOOL = {
  name: "Read",
  description: "Read a file from disk.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" } },
  },
};

function entry(over: Partial<IndexEntry> & Pick<IndexEntry, "request_id">): IndexEntry {
  return {
    route: "anthropic",
    endpoint: "/messages",
    status: 200,
    stream: false,
    model_requested: "claude-sonnet-4-6",
    model_remapped_to: "anthropic/claude-sonnet-4.6",
    tokens: { input: 1000, output: 60 },
    conversation_id: "root",
    is_subagent: false,
    detection: { confidence: "strong", signals: ["ua:claude-code"], detector: "claude-code" },
    first_user_snippet: "",
    assistant_tool_calls: [],
    concurrency_at_start: 0,
    ...over,
  };
}

/** A realistic single-session fixture: a root agent that spawns two parallel subagents. */
export function sampleRequests(): RequestFixture[] {
  return [
    {
      index: entry({
        request_id: 1,
        started_at: "2026-05-22T10:00:00.000Z",
        ended_at: "2026-05-22T10:00:02.000Z",
        duration_ms: 2000,
        ttfb_ms: 300,
        conversation_id: "root",
        first_user_snippet: "Research the codebase and summarise it",
        assistant_tool_calls: [
          { name: "Task", id: "t1" },
          { name: "Task", id: "t2" },
        ],
      }),
      request: {
        url: "/messages",
        body: {
          model: "claude-sonnet-4-6",
          system:
            "You are a coding agent.\n<rules>\n  Always be careful.\n</rules>",
          tools: [TASK_TOOL, READ_TOOL],
          messages: [
            { role: "user", content: "Research the codebase and summarise it" },
          ],
        },
      },
      response: {
        status: 200,
        body: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "I'll spawn two explorers in parallel." },
            {
              type: "tool_use",
              id: "t1",
              name: "Task",
              input: { subagent_type: "Explore", prompt: "Explore src/server" },
            },
            {
              type: "tool_use",
              id: "t2",
              name: "Task",
              input: { subagent_type: "Explore", prompt: "Explore src/viewer" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 1200, output_tokens: 90 },
        },
      },
      meta: {
        received_at: "2026-05-22T10:00:00.000Z",
        responded_to_client_at: "2026-05-22T10:00:02.000Z",
        duration_ms: 2000,
        ttfb_ms: 300,
      },
    },
    {
      index: entry({
        request_id: 2,
        started_at: "2026-05-22T10:00:02.000Z",
        ended_at: "2026-05-22T10:00:05.000Z",
        duration_ms: 3000,
        conversation_id: "subA",
        parent_conversation_id: "root",
        is_subagent: true,
        subagent_type: "Explore",
        concurrency_at_start: 1,
        first_user_snippet: "Explore src/server",
        detection: {
          confidence: "strong",
          signals: ["parent-emitted-task"],
          detector: "claude-code",
        },
      }),
      request: {
        url: "/messages",
        body: {
          model: "claude-sonnet-4-6",
          system: "You are an Explore subagent.",
          tools: [READ_TOOL],
          messages: [{ role: "user", content: "Explore src/server" }],
        },
      },
      response: {
        status: 200,
        body: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "src/server holds the proxy core." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 800, output_tokens: 40 },
        },
      },
    },
    {
      index: entry({
        request_id: 3,
        started_at: "2026-05-22T10:00:02.500Z",
        ended_at: "2026-05-22T10:00:06.000Z",
        duration_ms: 3500,
        stream: true,
        conversation_id: "subB",
        parent_conversation_id: "root",
        is_subagent: true,
        subagent_type: "Explore",
        concurrency_at_start: 2,
        first_user_snippet: "Explore src/viewer",
        detection: {
          confidence: "strong",
          signals: ["parent-emitted-task"],
          detector: "claude-code",
        },
      }),
      request: {
        url: "/messages",
        body: {
          model: "claude-sonnet-4-6",
          system: "You are an Explore subagent.",
          tools: [READ_TOOL],
          messages: [{ role: "user", content: "Explore src/viewer" }],
        },
      },
      response: {
        status: 200,
        body: [
          {
            event: "message_start",
            data: {
              type: "message_start",
              message: { usage: { input_tokens: 820, output_tokens: 0 } },
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
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "src/viewer " },
            },
          },
          {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "is the CLI viewer." },
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
              delta: { stop_reason: "end_turn" },
              usage: { output_tokens: 18 },
            },
          },
          { event: "message_stop", data: { type: "message_stop" } },
        ],
      },
    },
    {
      index: entry({
        request_id: 4,
        started_at: "2026-05-22T10:00:07.000Z",
        ended_at: "2026-05-22T10:00:09.000Z",
        duration_ms: 2000,
        conversation_id: "root",
        first_user_snippet: "Research the codebase and summarise it",
      }),
      request: {
        url: "/messages",
        body: {
          model: "claude-sonnet-4-6",
          system: "You are a coding agent.",
          tools: [TASK_TOOL, READ_TOOL],
          messages: [
            { role: "user", content: "Research the codebase and summarise it" },
            {
              role: "assistant",
              content: [{ type: "text", text: "I'll spawn two explorers." }],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "t1",
                  content: "src/server holds the proxy core.",
                },
              ],
            },
          ],
        },
      },
      response: {
        status: 200,
        body: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "The project has a proxy core and a CLI viewer." },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 1500, output_tokens: 70 },
        },
      },
    },
  ];
}

/** Write the sample session into `<baseDir>/1/`. Returns the base directory. */
export function buildSampleSessions(baseDir: string): string {
  const sessionDir = path.join(baseDir, "1");
  const requestsDir = path.join(sessionDir, "requests");
  fs.mkdirSync(requestsDir, { recursive: true });

  const requests = sampleRequests();
  const indexLines: string[] = [];
  for (const r of requests) {
    indexLines.push(JSON.stringify(r.index));
    const dir = path.join(requestsDir, String(r.index.request_id));
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, "request.json"), r.request);
    writeJson(path.join(dir, "response.json"), r.response);
    writeJson(
      path.join(dir, "raw_request.json"),
      r.rawRequest ?? { url: "https://upstream/v1/chat/completions", method: "POST", headers: {}, body: {} }
    );
    writeJson(
      path.join(dir, "raw_response.json"),
      r.rawResponse ?? { status: r.index.status, headers: {}, body: null }
    );
    if (r.meta) writeJson(path.join(dir, "meta.json"), r.meta);
  }
  fs.writeFileSync(path.join(sessionDir, "index.jsonl"), indexLines.join("\n") + "\n");
  return baseDir;
}
