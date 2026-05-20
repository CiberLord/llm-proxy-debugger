import type { NormalizedRequest } from "./detect/types";
import { conversationIdFor } from "./detect/conversation-id";
import type { IndexAssistantToolCall, IndexTokenStats } from "./index/types";

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function anthropicContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n");
}

function anthropicSystemToText(sys: unknown): string {
  if (typeof sys === "string") return sys;
  if (Array.isArray(sys)) return anthropicContentToText(sys);
  return "";
}

export function normalizeAnthropicRequest(
  body: unknown,
  userAgent: string | undefined
): NormalizedRequest {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const systemText = anthropicSystemToText(obj.system);
  const messages = Array.isArray(obj.messages) ? (obj.messages as unknown[]) : [];
  let firstUserText = "";
  for (const m of messages) {
    if (m && typeof m === "object") {
      const mm = m as Record<string, unknown>;
      if (mm.role === "user") {
        firstUserText = anthropicContentToText(mm.content);
        break;
      }
    }
  }
  const tools: string[] = [];
  if (Array.isArray(obj.tools)) {
    for (const t of obj.tools as unknown[]) {
      if (t && typeof t === "object") {
        const tt = t as Record<string, unknown>;
        if (typeof tt.name === "string") tools.push(tt.name);
      }
    }
  }
  const model = asString(obj.model);
  return {
    route: "anthropic",
    userAgent,
    systemText,
    firstUserText,
    toolNamesDeclared: tools,
    model,
    conversationId: conversationIdFor(systemText, firstUserText),
  };
}

export function normalizeOpenAIRequest(
  body: unknown,
  userAgent: string | undefined
): NormalizedRequest {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const messages = Array.isArray(obj.messages) ? (obj.messages as unknown[]) : [];
  let systemText = "";
  let firstUserText = "";
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const mm = m as Record<string, unknown>;
    if (mm.role === "system" && !systemText) {
      systemText = openAIContentToText(mm.content);
    } else if (mm.role === "user" && !firstUserText) {
      firstUserText = openAIContentToText(mm.content);
    }
    if (systemText && firstUserText) break;
  }
  const tools: string[] = [];
  if (Array.isArray(obj.tools)) {
    for (const t of obj.tools as unknown[]) {
      if (t && typeof t === "object") {
        const tt = t as Record<string, unknown>;
        const fn = tt.function;
        if (fn && typeof fn === "object") {
          const name = (fn as Record<string, unknown>).name;
          if (typeof name === "string") tools.push(name);
        }
      }
    }
  }
  return {
    route: "openai",
    userAgent,
    systemText,
    firstUserText,
    toolNamesDeclared: tools,
    model: asString(obj.model),
    conversationId: conversationIdFor(systemText, firstUserText),
  };
}

function openAIContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") parts.push(p.text);
    }
  }
  return parts.join("\n");
}

/** Extract `tool_use` blocks from an Anthropic-shape response body. */
export function extractAnthropicToolCalls(
  resp: unknown
): Array<{ name: string; id?: string; input?: unknown }> {
  if (!resp || typeof resp !== "object") return [];
  const content = (resp as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const out: Array<{ name: string; id?: string; input?: unknown }> = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use" && typeof b.name === "string") {
        out.push({
          name: b.name,
          id: typeof b.id === "string" ? b.id : undefined,
          input: b.input,
        });
      }
    }
  }
  return out;
}

/** Extract tool_calls from a non-streaming OpenAI response. */
export function extractOpenAIToolCalls(
  resp: unknown
): Array<{ name: string; id?: string; input?: unknown }> {
  if (!resp || typeof resp !== "object") return [];
  const choices = (resp as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const first = choices[0] as Record<string, unknown> | null;
  const message = first?.message as Record<string, unknown> | undefined;
  const toolCalls = message?.tool_calls;
  if (!Array.isArray(toolCalls)) return [];
  const out: Array<{ name: string; id?: string; input?: unknown }> = [];
  for (const tc of toolCalls) {
    if (tc && typeof tc === "object") {
      const t = tc as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      const name = fn?.name;
      if (typeof name === "string") {
        let input: unknown;
        const args = fn?.arguments;
        if (typeof args === "string") {
          try {
            input = JSON.parse(args);
          } catch {
            input = args;
          }
        }
        out.push({
          name,
          id: typeof t.id === "string" ? t.id : undefined,
          input,
        });
      }
    }
  }
  return out;
}

export function extractAnthropicTokens(resp: unknown): IndexTokenStats {
  if (!resp || typeof resp !== "object") return {};
  const u = (resp as Record<string, unknown>).usage as Record<string, unknown> | undefined;
  if (!u) return {};
  return {
    input: typeof u.input_tokens === "number" ? u.input_tokens : undefined,
    output: typeof u.output_tokens === "number" ? u.output_tokens : undefined,
    cache_read:
      typeof u.cache_read_input_tokens === "number"
        ? u.cache_read_input_tokens
        : undefined,
    cache_creation:
      typeof u.cache_creation_input_tokens === "number"
        ? u.cache_creation_input_tokens
        : undefined,
  };
}

export function extractOpenAITokens(resp: unknown): IndexTokenStats {
  if (!resp || typeof resp !== "object") return {};
  const u = (resp as Record<string, unknown>).usage as Record<string, unknown> | undefined;
  if (!u) return {};
  return {
    input: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined,
    output: typeof u.completion_tokens === "number" ? u.completion_tokens : undefined,
  };
}

export function snippet(text: string, limit = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t;
  return t.slice(0, limit - 1) + "…";
}

export function toIndexToolCalls(
  calls: Array<{ name: string; id?: string }>
): IndexAssistantToolCall[] {
  return calls.map((c) => ({ name: c.name, id: c.id }));
}
