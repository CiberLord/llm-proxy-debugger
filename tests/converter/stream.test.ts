import { describe, it, expect } from "vitest";
import { createAnthropicStreamConverter } from "../../src/server/converter/stream";

function chunkFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

interface ParsedEvent {
  event: string;
  data: any;
}

function parseAnthropicSSE(text: string): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (!event) continue;
    out.push({ event, data: data ? JSON.parse(data) : null });
  }
  return out;
}

describe("createAnthropicStreamConverter", () => {
  it("translates text-only OpenAI stream into Anthropic events", () => {
    const conv = createAnthropicStreamConverter("msg_1", "claude-sonnet-4-6");
    let out = "";
    out += conv.feed(
      chunkFrame({
        id: "x",
        model: "openai/gpt-4.1",
        choices: [{ index: 0, delta: { role: "assistant" } }],
      })
    );
    out += conv.feed(
      chunkFrame({
        id: "x",
        choices: [{ index: 0, delta: { content: "Hi" } }],
      })
    );
    out += conv.feed(
      chunkFrame({
        id: "x",
        choices: [{ index: 0, delta: { content: "!" } }],
      })
    );
    out += conv.feed(
      chunkFrame({
        id: "x",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      })
    );
    out += conv.feed("data: [DONE]\n\n");
    out += conv.end();

    const events = parseAnthropicSSE(out);
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    expect(events[0].data.message.model).toBe("claude-sonnet-4-6");
    expect(events[1].data).toMatchObject({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });
    expect(events[2].data.delta).toEqual({ type: "text_delta", text: "Hi" });
    expect(events[3].data.delta).toEqual({ type: "text_delta", text: "!" });
    expect(events[5].data).toEqual({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { input_tokens: 12, output_tokens: 5 },
    });

    expect(conv.finalResponse()).toMatchObject({
      content: [{ type: "text", text: "Hi!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 5 },
    });
  });

  it("handles streamed tool_calls with input_json_delta", () => {
    const conv = createAnthropicStreamConverter("msg_2", "claude-sonnet-4-6");
    let out = "";
    out += conv.feed(
      chunkFrame({
        id: "x",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"ci' },
                },
              ],
            },
          },
        ],
      })
    );
    out += conv.feed(
      chunkFrame({
        id: "x",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'ty":"Almaty"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      })
    );
    out += conv.end();

    const events = parseAnthropicSSE(out);
    const tags = events.map((e) => e.event);
    expect(tags).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    expect(events[1].data.content_block).toMatchObject({
      type: "tool_use",
      id: "call_1",
      name: "get_weather",
    });
    expect(events[2].data.delta).toEqual({
      type: "input_json_delta",
      partial_json: '{"ci',
    });
    expect(events[3].data.delta).toEqual({
      type: "input_json_delta",
      partial_json: 'ty":"Almaty"}',
    });
    expect(events[5].data.delta.stop_reason).toBe("tool_use");

    expect(conv.finalResponse()).toMatchObject({
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "get_weather",
          input: { city: "Almaty" },
        },
      ],
      stop_reason: "tool_use",
    });
  });

  it("buffers partial lines across feed() calls", () => {
    const conv = createAnthropicStreamConverter("m", "claude-x");
    const fullChunk = chunkFrame({
      id: "x",
      choices: [{ index: 0, delta: { content: "abc" } }],
    });
    // Split in the middle of the JSON payload.
    const half = Math.floor(fullChunk.length / 2);
    let out = "";
    out += conv.feed(fullChunk.slice(0, half));
    expect(out).toBe(""); // no full line yet
    out += conv.feed(fullChunk.slice(half));
    out += conv.end();

    const events = parseAnthropicSSE(out);
    const delta = events.find((e) => e.event === "content_block_delta");
    expect(delta?.data.delta).toEqual({ type: "text_delta", text: "abc" });
  });

  it("emits message_start even on empty stream", () => {
    const conv = createAnthropicStreamConverter("m", "claude-x");
    const out = conv.end();
    const events = parseAnthropicSSE(out);
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "message_delta",
      "message_stop",
    ]);
  });
});
