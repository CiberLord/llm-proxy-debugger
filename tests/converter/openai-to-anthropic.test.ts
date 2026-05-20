import { describe, it, expect } from "vitest";
import {
  openAIToAnthropicResponse,
  mapStopReason,
} from "../../src/server/converter/openai-to-anthropic";

describe("mapStopReason", () => {
  it.each([
    ["stop", "end_turn"],
    ["length", "max_tokens"],
    ["tool_calls", "tool_use"],
    ["function_call", "tool_use"],
    ["content_filter", "stop_sequence"],
    ["something_else", "end_turn"],
  ])("%s → %s", (input, expected) => {
    expect(mapStopReason(input)).toBe(expected);
  });

  it("null/undefined → null", () => {
    expect(mapStopReason(null)).toBeNull();
    expect(mapStopReason(undefined)).toBeNull();
  });
});

describe("openAIToAnthropicResponse", () => {
  it("converts plain text response with usage", () => {
    const resp = openAIToAnthropicResponse(
      {
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 0,
        model: "openai/gpt-4.1",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
      "claude-sonnet-4-6"
    );
    expect(resp).toEqual({
      id: "chatcmpl-1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  });

  it("merges tool_calls into content as tool_use blocks", () => {
    const resp = openAIToAnthropicResponse(
      {
        id: "id",
        object: "chat.completion",
        created: 0,
        model: "x",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "calling tool",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"city":"Almaty"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "claude-sonnet-4-6"
    );
    expect(resp.content).toEqual([
      { type: "text", text: "calling tool" },
      {
        type: "tool_use",
        id: "call_1",
        name: "get_weather",
        input: { city: "Almaty" },
      },
    ]);
    expect(resp.stop_reason).toBe("tool_use");
    expect(resp.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it("falls back to raw string when tool arguments aren't valid JSON", () => {
    const resp = openAIToAnthropicResponse(
      {
        id: "id",
        object: "chat.completion",
        created: 0,
        model: "x",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "c",
                  type: "function",
                  function: { name: "n", arguments: "not-json" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "m"
    );
    expect(resp.content).toEqual([
      { type: "tool_use", id: "c", name: "n", input: "not-json" },
    ]);
  });

  it("emits empty content when assistant content is null and no tool_calls", () => {
    const resp = openAIToAnthropicResponse(
      {
        id: "id",
        object: "chat.completion",
        created: 0,
        model: "x",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null },
            finish_reason: "stop",
          },
        ],
      },
      "m"
    );
    expect(resp.content).toEqual([]);
  });
});
