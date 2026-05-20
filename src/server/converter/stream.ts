// Translates an OpenAI Chat Completion SSE stream into Anthropic Messages SSE events.
//
// OpenAI emits `data: {…}\n\n` lines with chat.completion.chunk objects, ending with
// `data: [DONE]`. Anthropic emits typed events: message_start, content_block_start,
// content_block_delta, content_block_stop, message_delta, message_stop.

import { mapStopReason } from "./openai-to-anthropic";

interface OpenAIDeltaToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

interface OpenAIStreamChunk {
  id: string;
  model?: string;
  choices?: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIDeltaToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

interface ToolBlockState {
  anthropicIndex: number;
  id: string;
  name: string;
  argsBuffer: string;
}

export interface StreamConverter {
  /** Feed raw upstream bytes/text. Returns Anthropic SSE text to send to client. */
  feed(chunk: string): string;
  /** Finalize after upstream stream ends. Returns trailing Anthropic SSE. */
  end(): string;
  /** Final synthesized Anthropic response object (for response.json). */
  finalResponse(): unknown;
}

export function createAnthropicStreamConverter(
  messageId: string,
  originalModel: string
): StreamConverter {
  let started = false;
  let textBlockOpen = false;
  let textBlockIndex = -1;
  let nextBlockIndex = 0;
  let accumulatedText = "";
  const toolBlocks = new Map<number /*openai index*/, ToolBlockState>();
  let finishReason: string | null | undefined = null;
  let usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 0,
    output_tokens: 0,
  };
  let lineBuffer = "";
  let modelFromUpstream = originalModel;
  let ended = false;

  function emitMessageStart(): string {
    started = true;
    return sse("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model: originalModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function openTextBlock(): string {
    textBlockIndex = nextBlockIndex++;
    textBlockOpen = true;
    return sse("content_block_start", {
      type: "content_block_start",
      index: textBlockIndex,
      content_block: { type: "text", text: "" },
    });
  }

  function closeTextBlock(): string {
    if (!textBlockOpen) return "";
    textBlockOpen = false;
    return sse("content_block_stop", {
      type: "content_block_stop",
      index: textBlockIndex,
    });
  }

  function openToolBlock(
    openaiIdx: number,
    id: string,
    name: string
  ): { out: string; state: ToolBlockState } {
    const anthropicIndex = nextBlockIndex++;
    const state: ToolBlockState = {
      anthropicIndex,
      id,
      name,
      argsBuffer: "",
    };
    toolBlocks.set(openaiIdx, state);
    const out = sse("content_block_start", {
      type: "content_block_start",
      index: anthropicIndex,
      content_block: {
        type: "tool_use",
        id,
        name,
        input: {},
      },
    });
    return { out, state };
  }

  function processChunkObject(chunk: OpenAIStreamChunk): string {
    let out = "";
    if (chunk.model) modelFromUpstream = chunk.model;

    if (!started) out += emitMessageStart();

    const choice = chunk.choices?.[0];
    if (choice) {
      const delta = choice.delta || {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        if (!textBlockOpen) out += openTextBlock();
        accumulatedText += delta.content;
        out += sse("content_block_delta", {
          type: "content_block_delta",
          index: textBlockIndex,
          delta: { type: "text_delta", text: delta.content },
        });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          let state = toolBlocks.get(tc.index);
          if (!state) {
            // Need name + id to open. OpenAI usually sends both in the first chunk for a tool call.
            const id = tc.id ?? `tool_${tc.index}`;
            const name = tc.function?.name ?? "";
            if (textBlockOpen) out += closeTextBlock();
            const opened = openToolBlock(tc.index, id, name);
            out += opened.out;
            state = opened.state;
          }
          const argDelta = tc.function?.arguments;
          if (typeof argDelta === "string" && argDelta.length > 0) {
            state.argsBuffer += argDelta;
            out += sse("content_block_delta", {
              type: "content_block_delta",
              index: state.anthropicIndex,
              delta: { type: "input_json_delta", partial_json: argDelta },
            });
          }
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    if (chunk.usage) {
      usage = {
        input_tokens: chunk.usage.prompt_tokens ?? usage.input_tokens,
        output_tokens: chunk.usage.completion_tokens ?? usage.output_tokens,
      };
    }

    return out;
  }

  function processLine(line: string): string {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (!trimmed.startsWith("data:")) return "";
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return "";
    try {
      const obj = JSON.parse(payload) as OpenAIStreamChunk;
      return processChunkObject(obj);
    } catch {
      return "";
    }
  }

  return {
    feed(chunk: string): string {
      lineBuffer += chunk;
      let out = "";
      let nl: number;
      while ((nl = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, nl);
        lineBuffer = lineBuffer.slice(nl + 1);
        out += processLine(line);
      }
      return out;
    },
    end(): string {
      if (ended) return "";
      ended = true;
      let out = "";
      if (lineBuffer.trim()) {
        out += processLine(lineBuffer);
        lineBuffer = "";
      }
      if (!started) out += emitMessageStart();

      if (textBlockOpen) out += closeTextBlock();
      for (const state of toolBlocks.values()) {
        out += sse("content_block_stop", {
          type: "content_block_stop",
          index: state.anthropicIndex,
        });
      }

      out += sse("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: mapStopReason(finishReason),
          stop_sequence: null,
        },
        usage,
      });
      out += sse("message_stop", { type: "message_stop" });
      return out;
    },
    finalResponse(): unknown {
      const content: Array<unknown> = [];
      if (accumulatedText) {
        content.push({ type: "text", text: accumulatedText });
      }
      for (const state of toolBlocks.values()) {
        let input: unknown = {};
        try {
          input = state.argsBuffer ? JSON.parse(state.argsBuffer) : {};
        } catch {
          input = state.argsBuffer;
        }
        content.push({
          type: "tool_use",
          id: state.id,
          name: state.name,
          input,
        });
      }
      return {
        id: messageId,
        type: "message",
        role: "assistant",
        model: modelFromUpstream || originalModel,
        content,
        stop_reason: mapStopReason(finishReason),
        stop_sequence: null,
        usage,
      };
    },
  };
}
