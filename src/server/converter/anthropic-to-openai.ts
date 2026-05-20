// Converts Anthropic Messages API request body → OpenAI Chat Completions body.

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
    }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content?: string | Array<{ type: string; text?: string }>;
      is_error?: boolean;
    };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: unknown;
  }>;
  tool_choice?:
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string }
    | { type: "none" };
  metadata?: unknown;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<unknown> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  // Modern OpenAI-compatible APIs (gpt-5.x, o1+, etc.) use `max_completion_tokens`;
  // `max_tokens` is rejected with `unsupported_parameter`. We emit the new name.
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters: unknown };
  }>;
  tool_choice?: "auto" | "none" | "required" | {
    type: "function";
    function: { name: string };
  };
}

function systemToString(
  system: AnthropicRequest["system"]
): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

function toolResultContent(
  c: Extract<AnthropicContentBlock, { type: "tool_result" }>
): string {
  if (typeof c.content === "string") return c.content;
  if (Array.isArray(c.content)) {
    return c.content
      .map((b) => (b.type === "text" && b.text ? b.text : ""))
      .join("");
  }
  return "";
}

function convertUserMessage(
  msg: AnthropicMessage,
  out: OpenAIMessage[]
): void {
  if (typeof msg.content === "string") {
    out.push({ role: "user", content: msg.content });
    return;
  }

  const parts: Array<unknown> = [];
  const toolResults: Array<{ tool_use_id: string; content: string }> = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      let url: string;
      if (block.source.type === "base64") {
        url = `data:${block.source.media_type};base64,${block.source.data}`;
      } else {
        url = block.source.url;
      }
      parts.push({ type: "image_url", image_url: { url } });
    } else if (block.type === "tool_result") {
      toolResults.push({
        tool_use_id: block.tool_use_id,
        content: toolResultContent(block),
      });
    }
  }

  if (parts.length > 0) {
    const onlyText =
      parts.length === 1 && (parts[0] as { type: string }).type === "text";
    out.push({
      role: "user",
      content: onlyText ? (parts[0] as { text: string }).text : (parts as Array<unknown>),
    });
  }

  for (const tr of toolResults) {
    out.push({
      role: "tool",
      tool_call_id: tr.tool_use_id,
      content: tr.content,
    });
  }
}

function convertAssistantMessage(
  msg: AnthropicMessage,
  out: OpenAIMessage[]
): void {
  if (typeof msg.content === "string") {
    out.push({ role: "assistant", content: msg.content });
    return;
  }

  let text = "";
  const toolCalls: NonNullable<OpenAIMessage["tool_calls"]> = [];

  for (const block of msg.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  const m: OpenAIMessage = {
    role: "assistant",
    content: text || null,
  };
  if (toolCalls.length > 0) m.tool_calls = toolCalls;
  out.push(m);
}

export function anthropicToOpenAIRequest(
  body: AnthropicRequest
): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  const sys = systemToString(body.system);
  if (sys) messages.push({ role: "system", content: sys });

  for (const m of body.messages) {
    if (m.role === "user") convertUserMessage(m, messages);
    else convertAssistantMessage(m, messages);
  }

  const out: OpenAIRequest = {
    model: body.model,
    messages,
  };

  if (body.max_tokens !== undefined) out.max_completion_tokens = body.max_tokens;
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  if (body.stop_sequences && body.stop_sequences.length > 0)
    out.stop = body.stop_sequences;
  if (body.stream) {
    out.stream = true;
    out.stream_options = { include_usage: true };
  }

  if (body.tools && body.tools.length > 0) {
    out.tools = body.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  if (body.tool_choice) {
    switch (body.tool_choice.type) {
      case "auto":
        out.tool_choice = "auto";
        break;
      case "any":
        out.tool_choice = "required";
        break;
      case "none":
        out.tool_choice = "none";
        break;
      case "tool":
        out.tool_choice = {
          type: "function",
          function: { name: body.tool_choice.name },
        };
        break;
    }
  }

  return out;
}

export type { AnthropicRequest, OpenAIRequest };
