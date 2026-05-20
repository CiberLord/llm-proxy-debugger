// Converts a non-streaming OpenAI Chat Completion response → Anthropic Messages response.

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string | null;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContent[];
  stop_reason: string | null;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

export function mapStopReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "content_filter":
      return "stop_sequence";
    case null:
    case undefined:
      return null;
    default:
      return "end_turn";
  }
}

function safeParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function openAIToAnthropicResponse(
  resp: OpenAIResponse,
  originalModel: string
): AnthropicResponse {
  const choice = resp.choices[0];
  const content: AnthropicContent[] = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: safeParseJSON(tc.function.arguments || "{}"),
      });
    }
  }

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: originalModel,
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

export type { OpenAIResponse, AnthropicResponse };
