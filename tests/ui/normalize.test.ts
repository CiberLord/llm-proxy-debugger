import { describe, it, expect } from "vitest";
import {
  assembleAnthropicStream,
  assembleOpenAIStream,
  normalizeRequest,
  normalizeResponse,
} from "../../src/ui/server/normalize";

describe("normalizeRequest — anthropic", () => {
  it("extracts system blocks, tools and messages", () => {
    const view = normalizeRequest("anthropic", {
      model: "claude-sonnet-4-6",
      system: "You are helpful.\n<rules>be nice</rules>",
      tools: [{ name: "Read", description: "read a file", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(view.model).toBe("claude-sonnet-4-6");
    expect(view.system).toEqual([{ text: "You are helpful.\n<rules>be nice</rules>" }]);
    expect(view.tools).toEqual([
      { name: "Read", description: "read a file", schema: { type: "object" } },
    ]);
    expect(view.messages).toEqual([{ role: "user", blocks: [{ kind: "text", text: "hi" }] }]);
  });

  it("treats a user message of tool_result blocks as the tool role", () => {
    const view = normalizeRequest("anthropic", {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false },
          ],
        },
      ],
    });
    expect(view.messages[0].role).toBe("tool");
    expect(view.messages[0].blocks[0]).toEqual({
      kind: "tool_result",
      toolUseId: "t1",
      content: "ok",
      isError: false,
    });
  });
});

describe("normalizeRequest — openai", () => {
  it("splits system messages and parses assistant tool calls", () => {
    const view = normalizeRequest("openai", {
      model: "gpt-x",
      messages: [
        { role: "system", content: "sys prompt" },
        { role: "user", content: "question" },
        {
          role: "assistant",
          content: "calling",
          tool_calls: [
            { id: "c1", function: { name: "search", arguments: '{"q":"x"}' } },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "result" },
      ],
      tools: [{ type: "function", function: { name: "search", parameters: { type: "object" } } }],
    });
    expect(view.system).toEqual([{ text: "sys prompt" }]);
    expect(view.tools).toEqual([{ name: "search", description: undefined, schema: { type: "object" } }]);
    expect(view.messages[1].blocks).toContainEqual({
      kind: "tool_use",
      id: "c1",
      name: "search",
      input: { q: "x" },
    });
    expect(view.messages[2]).toEqual({
      role: "tool",
      blocks: [{ kind: "tool_result", toolUseId: "c1", content: "result" }],
    });
  });
});

describe("normalizeResponse", () => {
  it("reads an anthropic non-streaming message", () => {
    const resp = normalizeResponse("anthropic", {
      type: "message",
      content: [
        { type: "text", text: "done" },
        { type: "tool_use", id: "t1", name: "Read", input: { path: "a" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    expect(resp?.blocks).toEqual([
      { kind: "text", text: "done" },
      { kind: "tool_use", id: "t1", name: "Read", input: { path: "a" } },
    ]);
    expect(resp?.stopReason).toBe("tool_use");
    expect(resp?.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });

  it("reads an openai non-streaming choice", () => {
    const resp = normalizeResponse("openai", {
      choices: [
        {
          message: {
            content: "answer",
            tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 3 },
    });
    expect(resp?.blocks[0]).toEqual({ kind: "text", text: "answer" });
    expect(resp?.blocks[1]).toEqual({ kind: "tool_use", id: "c1", name: "f", input: {} });
    expect(resp?.stopReason).toBe("tool_calls");
  });

  it("flags error response bodies", () => {
    const resp = normalizeResponse("anthropic", {
      type: "error",
      error: { message: "rate limited" },
    });
    expect(resp?.error).toBe("rate limited");
    expect(resp?.blocks).toEqual([]);
  });

  it("returns null for an empty body", () => {
    expect(normalizeResponse("anthropic", null)).toBeNull();
  });
});

describe("assembleAnthropicStream", () => {
  it("reassembles text and tool_use blocks from SSE events", () => {
    const view = assembleAnthropicStream([
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"a.ts"}' } } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } } },
    ]);
    expect(view.blocks).toEqual([
      { kind: "text", text: "Hello world" },
      { kind: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } },
    ]);
    expect(view.stopReason).toBe("end_turn");
    expect(view.usage).toEqual({ output_tokens: 9 });
  });
});

describe("assembleOpenAIStream", () => {
  it("reassembles content and tool calls from chunks", () => {
    const view = assembleOpenAIStream([
      { data: { choices: [{ delta: { content: "Hel" } }] } },
      { data: { choices: [{ delta: { content: "lo" } }] } },
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: '{"a":' } }] } }] } },
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, finish_reason: "tool_calls" }] } },
    ]);
    expect(view.blocks).toEqual([
      { kind: "text", text: "Hello" },
      { kind: "tool_use", id: "c1", name: "f", input: { a: 1 } },
    ]);
    expect(view.stopReason).toBe("tool_calls");
  });
});
