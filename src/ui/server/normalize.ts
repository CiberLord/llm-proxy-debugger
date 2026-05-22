import type {
  ChatMessage,
  ContentBlock,
  NormalizedResponseView,
  SystemBlock,
  ToolDef,
} from "./types";

type Route = "anthropic" | "openai";
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

/** Flatten arbitrary message content into readable text. */
function stringifyContent(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const b of v) {
      if (typeof b === "string") parts.push(b);
      else if (isObj(b) && typeof b.text === "string") parts.push(b.text);
      else parts.push(JSON.stringify(b, null, 2));
    }
    return parts.join("\n");
  }
  if (v == null) return "";
  return JSON.stringify(v, null, 2);
}

function systemToBlocks(system: unknown): SystemBlock[] {
  if (typeof system === "string")
    return system.trim() ? [{ text: system }] : [];
  if (Array.isArray(system)) {
    const out: SystemBlock[] = [];
    for (const b of system) {
      if (typeof b === "string" && b.trim()) out.push({ text: b });
      else if (isObj(b) && typeof b.text === "string") out.push({ text: b.text });
    }
    return out;
  }
  return [];
}

function anthropicBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string")
    return content ? [{ kind: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: ContentBlock[] = [];
  for (const raw of content) {
    if (!isObj(raw)) continue;
    const type = raw.type;
    if (type === "text" && typeof raw.text === "string") {
      out.push({ kind: "text", text: raw.text });
    } else if (type === "thinking" && typeof raw.thinking === "string") {
      out.push({ kind: "text", text: raw.thinking, thinking: true });
    } else if (type === "tool_use") {
      out.push({
        kind: "tool_use",
        id: asStr(raw.id) || undefined,
        name: asStr(raw.name),
        input: raw.input,
      });
    } else if (type === "tool_result") {
      out.push({
        kind: "tool_result",
        toolUseId: asStr(raw.tool_use_id) || undefined,
        content: stringifyContent(raw.content),
        isError: raw.is_error === true,
      });
    }
  }
  return out;
}

function anthropicMessages(messages: unknown): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of asArr(messages)) {
    if (!isObj(m)) continue;
    const blocks = anthropicBlocks(m.content);
    let role: ChatMessage["role"] = m.role === "assistant" ? "assistant" : "user";
    if (
      role === "user" &&
      blocks.length > 0 &&
      blocks.every((b) => b.kind === "tool_result")
    ) {
      role = "tool";
    }
    out.push({ role, blocks });
  }
  return out;
}

function openAIToolUseBlocks(m: Obj): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const tc of asArr(m.tool_calls)) {
    if (!isObj(tc)) continue;
    const fn = isObj(tc.function) ? tc.function : {};
    let input: unknown = (fn as Obj).arguments;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        /* keep raw string */
      }
    }
    out.push({
      kind: "tool_use",
      id: asStr(tc.id) || undefined,
      name: asStr((fn as Obj).name),
      input,
    });
  }
  return out;
}

function openAIMessages(messages: unknown): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of asArr(messages)) {
    if (!isObj(m)) continue;
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({
        role: "tool",
        blocks: [
          {
            kind: "tool_result",
            toolUseId: asStr(m.tool_call_id) || undefined,
            content: stringifyContent(m.content),
          },
        ],
      });
      continue;
    }
    const blocks: ContentBlock[] = [];
    const text = stringifyContent(m.content);
    if (text) blocks.push({ kind: "text", text });
    if (m.role === "assistant") blocks.push(...openAIToolUseBlocks(m));
    out.push({ role: m.role === "assistant" ? "assistant" : "user", blocks });
  }
  return out;
}

function openAISystem(messages: unknown): SystemBlock[] {
  const out: SystemBlock[] = [];
  for (const m of asArr(messages)) {
    if (isObj(m) && m.role === "system") {
      const t = stringifyContent(m.content);
      if (t) out.push({ text: t });
    }
  }
  return out;
}

function anthropicTools(tools: unknown): ToolDef[] {
  return asArr(tools)
    .filter(isObj)
    .map((t) => ({
      name: asStr(t.name),
      description: typeof t.description === "string" ? t.description : undefined,
      schema: t.input_schema,
    }));
}

function openAITools(tools: unknown): ToolDef[] {
  return asArr(tools)
    .filter(isObj)
    .map((t) => {
      const fn = isObj(t.function) ? t.function : t;
      return {
        name: asStr((fn as Obj).name),
        description:
          typeof (fn as Obj).description === "string"
            ? ((fn as Obj).description as string)
            : undefined,
        schema: (fn as Obj).parameters,
      };
    });
}

export interface NormalizedRequestView {
  model: string;
  system: SystemBlock[];
  tools: ToolDef[];
  messages: ChatMessage[];
}

/** Build a unified request view from an Anthropic- or OpenAI-shape request body. */
export function normalizeRequest(route: Route, body: unknown): NormalizedRequestView {
  const obj = isObj(body) ? body : {};
  if (route === "openai") {
    return {
      model: asStr(obj.model),
      system: openAISystem(obj.messages),
      tools: openAITools(obj.tools),
      messages: openAIMessages(obj.messages),
    };
  }
  return {
    model: asStr(obj.model),
    system: systemToBlocks(obj.system),
    tools: anthropicTools(obj.tools),
    messages: anthropicMessages(obj.messages),
  };
}

/** Unwrap a stored SSE event — items may be `{event,data}` or a raw event object. */
function eventPayload(item: unknown): Obj | null {
  if (!isObj(item)) return null;
  if (isObj(item.data)) return item.data;
  return item;
}

/** Reassemble an Anthropic streamed response (array of SSE events) into blocks. */
export function assembleAnthropicStream(events: unknown[]): NormalizedResponseView {
  type Acc =
    | { kind: "text"; text: string }
    | { kind: "tool_use"; id?: string; name: string; json: string };
  const acc: Acc[] = [];
  let stopReason: string | undefined;
  let usage: Obj | undefined;

  for (const item of events) {
    const data = eventPayload(item);
    if (!data) continue;
    const type = data.type;
    if (type === "message_start" && isObj(data.message) && isObj((data.message as Obj).usage)) {
      usage = (data.message as Obj).usage as Obj;
    } else if (type === "content_block_start") {
      const idx = typeof data.index === "number" ? data.index : acc.length;
      const cb = isObj(data.content_block) ? data.content_block : {};
      acc[idx] =
        cb.type === "tool_use"
          ? { kind: "tool_use", id: asStr(cb.id) || undefined, name: asStr(cb.name), json: "" }
          : { kind: "text", text: asStr(cb.text) };
    } else if (type === "content_block_delta") {
      const idx = typeof data.index === "number" ? data.index : 0;
      const delta = isObj(data.delta) ? data.delta : {};
      const b = acc[idx];
      if (!b) continue;
      if (b.kind === "text" && typeof delta.text === "string") b.text += delta.text;
      else if (b.kind === "tool_use" && typeof delta.partial_json === "string")
        b.json += delta.partial_json;
    } else if (type === "message_delta") {
      const delta = isObj(data.delta) ? data.delta : {};
      if (typeof delta.stop_reason === "string") stopReason = delta.stop_reason;
      if (isObj(data.usage)) usage = { ...(usage ?? {}), ...(data.usage as Obj) };
    }
  }

  const blocks: ContentBlock[] = [];
  for (const b of acc) {
    if (!b) continue;
    if (b.kind === "text") {
      blocks.push({ kind: "text", text: b.text });
    } else {
      let input: unknown = b.json;
      try {
        input = b.json ? JSON.parse(b.json) : {};
      } catch {
        /* keep raw string */
      }
      blocks.push({ kind: "tool_use", id: b.id, name: b.name, input });
    }
  }
  return { blocks, stopReason, usage };
}

/** Reassemble an OpenAI streamed response (array of chunks) into blocks. */
export function assembleOpenAIStream(events: unknown[]): NormalizedResponseView {
  let text = "";
  const calls: Array<{ id?: string; name: string; args: string }> = [];
  let stopReason: string | undefined;
  let usage: Obj | undefined;

  for (const item of events) {
    const data = eventPayload(item);
    if (!data) continue;
    if (isObj(data.usage)) usage = data.usage as Obj;
    const choice = asArr(data.choices)[0];
    if (!isObj(choice)) continue;
    if (typeof choice.finish_reason === "string") stopReason = choice.finish_reason;
    const delta = isObj(choice.delta) ? choice.delta : {};
    if (typeof delta.content === "string") text += delta.content;
    for (const tc of asArr(delta.tool_calls)) {
      if (!isObj(tc)) continue;
      const i = typeof tc.index === "number" ? tc.index : calls.length;
      const slot = calls[i] ?? (calls[i] = { name: "", args: "" });
      if (typeof tc.id === "string") slot.id = tc.id;
      const fn = isObj(tc.function) ? tc.function : {};
      if (typeof (fn as Obj).name === "string") slot.name += (fn as Obj).name as string;
      if (typeof (fn as Obj).arguments === "string")
        slot.args += (fn as Obj).arguments as string;
    }
  }

  const blocks: ContentBlock[] = [];
  if (text) blocks.push({ kind: "text", text });
  for (const c of calls) {
    if (!c) continue;
    let input: unknown = c.args;
    try {
      input = c.args ? JSON.parse(c.args) : {};
    } catch {
      /* keep raw string */
    }
    blocks.push({ kind: "tool_use", id: c.id, name: c.name, input });
  }
  return { blocks, stopReason, usage };
}

/** Build a unified response view from a stored response body (object or SSE array). */
export function normalizeResponse(
  route: Route,
  body: unknown
): NormalizedResponseView | null {
  if (body == null) return null;

  if (isObj(body) && (body.type === "error" || isObj(body.error))) {
    const err = isObj(body.error) ? body.error : body;
    return {
      blocks: [],
      error: asStr((err as Obj).message) || JSON.stringify(body),
    };
  }

  if (Array.isArray(body)) {
    return route === "openai"
      ? assembleOpenAIStream(body)
      : assembleAnthropicStream(body);
  }

  if (isObj(body)) {
    if (Array.isArray(body.content)) {
      return {
        blocks: anthropicBlocks(body.content),
        stopReason: asStr(body.stop_reason) || undefined,
        usage: isObj(body.usage) ? body.usage : undefined,
      };
    }
    if (Array.isArray(body.choices)) {
      const choice = body.choices[0];
      const msg = isObj(choice) && isObj(choice.message) ? choice.message : {};
      const blocks: ContentBlock[] = [];
      const text = stringifyContent((msg as Obj).content);
      if (text) blocks.push({ kind: "text", text });
      blocks.push(...openAIToolUseBlocks(msg as Obj));
      return {
        blocks,
        stopReason: isObj(choice) ? asStr(choice.finish_reason) || undefined : undefined,
        usage: isObj(body.usage) ? body.usage : undefined,
      };
    }
  }

  return { blocks: [{ kind: "text", text: stringifyContent(body) }] };
}
