import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config, RouteConfig } from "../../config";
import { Session, RequestLogger } from "./session";
import { applyModelRemap } from "./remap";
import {
  anthropicToOpenAIRequest,
  type AnthropicRequest,
} from "./converter/anthropic-to-openai";
import { openAIToAnthropicResponse } from "./converter/openai-to-anthropic";
import { createAnthropicStreamConverter } from "./converter/stream";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

function headersToObject(
  h: NodeJS.Dict<string | string[]>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function fetchHeadersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJSONSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface SSEEvent {
  event?: string;
  data: unknown;
}

/**
 * Parse a raw SSE text blob into a list of {event, data} entries.
 * `data:` payloads are JSON-decoded when possible, otherwise kept as strings.
 * Used to make response.json human-readable instead of one long SSE blob.
 */
function parseSSE(raw: string): SSEEvent[] {
  const out: SSEEvent[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0 && event === undefined) continue;
    const dataText = dataLines.join("\n");
    const entry: SSEEvent = { data: parseJSONSafe(dataText) };
    if (event !== undefined) entry.event = event;
    out.push(entry);
  }
  return out;
}

function buildForwardHeaders(
  reqHeaders: NodeJS.Dict<string | string[]>,
  apiKey: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (key === "authorization" || key === "x-api-key") continue;
    if (key === "anthropic-version" || key === "anthropic-beta") continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  out["Authorization"] = `Bearer ${apiKey}`;
  out["Content-Type"] = "application/json";
  return out;
}

function joinUrl(base: string, suffix: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return b + s;
}

function splitPathQuery(s: string): { path: string; query: string } {
  const q = s.indexOf("?");
  if (q === -1) return { path: s, query: "" };
  return { path: s.slice(0, q), query: s.slice(q) };
}

interface HandleResult {
  /** Path inside the route after the prefix, e.g. "/messages" or "/chat/completions". */
  subPath: string;
}

function matchRoute(
  url: string,
  prefix: string
): HandleResult | null {
  const normalized = "/" + prefix.replace(/^\/+|\/+$/g, "");
  if (url === normalized) return { subPath: "/" };
  if (url.startsWith(normalized + "/")) {
    return { subPath: url.slice(normalized.length) };
  }
  if (url.startsWith(normalized + "?")) {
    return { subPath: "/" + url.slice(normalized.length + 1) };
  }
  return null;
}

async function handleAnthropic(
  req: IncomingMessage,
  res: ServerResponse,
  sub: string,
  route: RouteConfig,
  logger: RequestLogger
): Promise<void> {
  const rawBody = await readBody(req);
  const incomingText = rawBody.toString("utf8");
  const incomingJson = parseJSONSafe(incomingText);

  logger.writeRequest({
    url: req.url || "",
    body: incomingJson,
  });

  // Clients (e.g. Claude Code) may add query params like ?beta=true.
  // Strip them for routing decisions, then forward them onto the upstream URL.
  const { path: subPath, query: subQuery } = splitPathQuery(sub);
  const isMessages = subPath.replace(/\/+$/, "") === "/messages";

  const originalBody = incomingJson as AnthropicRequest | null;
  const originalModel = originalBody?.model ?? "";
  const remappedModel = originalModel
    ? applyModelRemap(originalModel, route.target.modelsRemapping)
    : originalModel;

  let upstreamUrl: string;
  let upstreamBody: unknown;
  let stream = Boolean(
    originalBody && typeof originalBody === "object" && originalBody.stream
  );

  if (isMessages && originalBody && typeof originalBody === "object") {
    const converted = anthropicToOpenAIRequest({
      ...originalBody,
      model: remappedModel,
    });
    // Drop subQuery — we're hitting a different upstream endpoint that doesn't
    // understand Anthropic-specific params (e.g. ?beta=true).
    void subQuery;
    upstreamUrl = joinUrl(route.target.baseUrl, "/chat/completions");
    upstreamBody = converted;
  } else {
    upstreamUrl = joinUrl(route.target.baseUrl, sub);
    upstreamBody = incomingJson;
  }

  const upstreamHeaders = buildForwardHeaders(req.headers, route.target.apiKey);
  const upstreamBodyText =
    upstreamBody === null || upstreamBody === undefined
      ? ""
      : typeof upstreamBody === "string"
        ? upstreamBody
        : JSON.stringify(upstreamBody);

  logger.writeRawRequest({
    url: upstreamUrl,
    method: req.method || "POST",
    headers: upstreamHeaders,
    body:
      typeof upstreamBody === "string"
        ? upstreamBody
        : upstreamBody ?? null,
  });

  const upstream = await fetch(upstreamUrl, {
    method: req.method || "POST",
    headers: upstreamHeaders,
    body: upstreamBodyText || undefined,
  });

  const upstreamHeadersObj = fetchHeadersToObject(upstream.headers);
  const contentType = upstream.headers.get("content-type") || "";

  if (stream && upstream.ok && contentType.includes("text/event-stream")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const messageId = `msg_${logger.sessionId}_${logger.requestId}_${Date.now()}`;
    const conv = createAnthropicStreamConverter(messageId, originalModel);

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let rawAccum = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      rawAccum += text;
      const out = conv.feed(text);
      if (out) res.write(out);
    }
    const trailing = conv.end();
    if (trailing) res.write(trailing);
    res.end();

    logger.writeRawResponse({
      status: upstream.status,
      headers: upstreamHeadersObj,
      body: rawAccum,
    });
    logger.writeResponse({
      status: upstream.status,
      body: conv.finalResponse(),
    });
    return;
  }

  const text = await upstream.text();
  logger.writeRawResponse({
    status: upstream.status,
    headers: upstreamHeadersObj,
    body: text || null,
  });

  if (upstream.ok && isMessages) {
    const oaiResp = parseJSONSafe(text);
    let anthResp: unknown = null;
    if (oaiResp && typeof oaiResp === "object") {
      try {
        anthResp = openAIToAnthropicResponse(oaiResp as never, originalModel);
      } catch {
        anthResp = oaiResp;
      }
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(anthResp));
    logger.writeResponse({ status: upstream.status, body: anthResp });
    return;
  }

  // Non-200 or non-messages: pass through.
  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") || "application/json"
  );
  res.end(text);
  logger.writeResponse({
    status: upstream.status,
    body: text
      ? contentType.includes("text/event-stream")
        ? parseSSE(text)
        : parseJSONSafe(text)
      : null,
  });
}

async function handleOpenAI(
  req: IncomingMessage,
  res: ServerResponse,
  sub: string,
  route: RouteConfig,
  logger: RequestLogger
): Promise<void> {
  const rawBody = await readBody(req);
  const incomingText = rawBody.toString("utf8");
  const incomingJson = parseJSONSafe(incomingText);

  logger.writeRequest({
    url: req.url || "",
    body: incomingJson,
  });

  let upstreamBody: unknown = incomingJson;
  let stream = false;
  if (
    incomingJson &&
    typeof incomingJson === "object" &&
    !Array.isArray(incomingJson)
  ) {
    const obj = { ...(incomingJson as Record<string, unknown>) };
    const m = obj.model;
    if (typeof m === "string") {
      obj.model = applyModelRemap(m, route.target.modelsRemapping);
    }
    // Modern OpenAI-compatible models require `max_completion_tokens`.
    if (obj.max_tokens !== undefined && obj.max_completion_tokens === undefined) {
      obj.max_completion_tokens = obj.max_tokens;
      delete obj.max_tokens;
    }
    stream = obj.stream === true;
    upstreamBody = obj;
  }

  const upstreamUrl = joinUrl(route.target.baseUrl, sub);
  const upstreamHeaders = buildForwardHeaders(req.headers, route.target.apiKey);
  const upstreamBodyText =
    upstreamBody === null || upstreamBody === undefined
      ? ""
      : typeof upstreamBody === "string"
        ? upstreamBody
        : JSON.stringify(upstreamBody);

  logger.writeRawRequest({
    url: upstreamUrl,
    method: req.method || "POST",
    headers: upstreamHeaders,
    body:
      typeof upstreamBody === "string" ? upstreamBody : upstreamBody ?? null,
  });

  const upstream = await fetch(upstreamUrl, {
    method: req.method || "POST",
    headers: upstreamHeaders,
    body: upstreamBodyText || undefined,
  });

  const upstreamHeadersObj = fetchHeadersToObject(upstream.headers);
  const contentType = upstream.headers.get("content-type") || "";

  if (stream && upstream.ok && contentType.includes("text/event-stream")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    let rawAccum = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      rawAccum += text;
      res.write(text);
    }
    res.end();
    logger.writeRawResponse({
      status: upstream.status,
      headers: upstreamHeadersObj,
      body: rawAccum,
    });
    logger.writeResponse({
      status: upstream.status,
      body: parseSSE(rawAccum),
    });
    return;
  }

  const text = await upstream.text();
  logger.writeRawResponse({
    status: upstream.status,
    headers: upstreamHeadersObj,
    body: text || null,
  });

  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") || "application/json"
  );
  res.end(text);
  logger.writeResponse({
    status: upstream.status,
    body: text
      ? contentType.includes("text/event-stream")
        ? parseSSE(text)
        : parseJSONSafe(text)
      : null,
  });
}

export interface CreateServerOptions {
  sessionsDir?: string;
  quiet?: boolean;
}

export function createServer(
  config: Config,
  opts: CreateServerOptions = {}
): http.Server {
  const anthropicPrefix = config.proxy.anthropic.local.baseUrl;
  const openaiPrefix = config.proxy.openai.local.baseUrl;
  const session = new Session(opts.sessionsDir);
  if (!opts.quiet) {
    console.log(`Session #${session.id} → ${session.dir}`);
  }

  return http.createServer(async (req, res) => {
    const url = req.url || "/";

    if (req.method === "GET" && url === "/") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end(
        `LLM Proxy Gateway\n  /${anthropicPrefix}/...\n  /${openaiPrefix}/...\n`
      );
      return;
    }

    try {
      const a = matchRoute(url, anthropicPrefix);
      if (a) {
        const logger = session.newRequest();
        if (!opts.quiet) {
          console.log(
            `[session ${logger.sessionId} req ${logger.requestId}] ${req.method} ${url} → anthropic`
          );
        }
        await handleAnthropic(req, res, a.subPath, config.proxy.anthropic, logger);
        return;
      }
      const o = matchRoute(url, openaiPrefix);
      if (o) {
        const logger = session.newRequest();
        if (!opts.quiet) {
          console.log(
            `[session ${logger.sessionId} req ${logger.requestId}] ${req.method} ${url} → openai`
          );
        }
        await handleOpenAI(req, res, o.subPath, config.proxy.openai, logger);
        return;
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "not_found", path: url }));
    } catch (err) {
      console.error("proxy error:", err);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
      }
      try {
        res.end(
          JSON.stringify({
            error: "proxy_error",
            message: err instanceof Error ? err.message : String(err),
          })
        );
      } catch {
        // already ended
      }
    }
  });
}

// keep linter happy about imported type
export type { Config };
// silence unused-import for headersToObject (kept for potential future request logging)
void headersToObject;
