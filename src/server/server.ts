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
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { anthropicSdkBaseUrl, serializeAnthropicSSE } from "./anthropic-sdk";
import { Timings } from "./timings";
import { runDetectors } from "./detect";
import type { DetectionResult, NormalizedRequest } from "./detect/types";
import type { IndexEntry, IndexTokenStats } from "./index/types";
import {
  normalizeAnthropicRequest,
  normalizeOpenAIRequest,
  extractAnthropicToolCalls,
  extractOpenAIToolCalls,
  extractAnthropicTokens,
  extractOpenAITokens,
  snippet,
  toIndexToolCalls,
} from "./instrument";

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

interface FinalizeArgs {
  session: Session;
  timings: Timings;
  route: "anthropic" | "openai";
  normalized: NormalizedRequest;
  detection: DetectionResult;
  upstreamStatus: number;
  stream: boolean;
  endpoint: string;
  modelRequested: string;
  modelRemapped: string;
  assistantBody: unknown;
  /** Which response shape `assistantBody` follows. */
  responseShape: "anthropic" | "openai" | "none";
  requestId: number;
  concurrencyAtStart: number;
  error?: string;
}

function finalizeIndex(args: FinalizeArgs): void {
  const {
    session,
    timings,
    route,
    normalized,
    detection,
    upstreamStatus,
    stream,
    endpoint,
    modelRequested,
    modelRemapped,
    assistantBody,
    responseShape,
    requestId,
    concurrencyAtStart,
    error,
  } = args;

  let toolCalls: Array<{ name: string; id?: string; input?: unknown }> = [];
  let tokens: IndexTokenStats = {};
  if (responseShape === "anthropic") {
    toolCalls = extractAnthropicToolCalls(assistantBody);
    tokens = extractAnthropicTokens(assistantBody);
  } else if (responseShape === "openai") {
    toolCalls = extractOpenAIToolCalls(assistantBody);
    tokens = extractOpenAITokens(assistantBody);
  }

  // Record assistant tool_calls for future correlation, and register any Task spawns.
  session.detectionContext.noteAssistantToolCalls(
    normalized.conversationId,
    toolCalls.map((t) => ({ name: t.name, input: t.input }))
  );
  for (const tc of toolCalls) {
    if (tc.name === "Task") {
      let subagentType: string | undefined;
      if (tc.input && typeof tc.input === "object") {
        const v = (tc.input as Record<string, unknown>).subagent_type;
        if (typeof v === "string") subagentType = v;
      }
      session.detectionContext.registerPendingSpawn(
        normalized.conversationId,
        subagentType
      );
    }
  }

  const meta = timings.toMeta();
  const entry: IndexEntry = {
    request_id: requestId,
    route,
    endpoint,
    started_at: meta.received_at,
    ended_at: meta.responded_to_client_at,
    duration_ms: meta.duration_ms,
    ttfb_ms: meta.ttfb_ms,
    status: upstreamStatus,
    stream,
    model_requested: modelRequested,
    model_remapped_to: modelRemapped,
    user_agent: normalized.userAgent,
    client_app_hint: detection.client_app_hint,
    tokens,
    conversation_id: detection.conversation_id,
    parent_conversation_id: detection.parent_conversation_id,
    is_subagent: detection.is_subagent,
    subagent_type: detection.subagent_type,
    detection: {
      confidence: detection.confidence,
      signals: detection.signals,
      detector: detection.detector,
    },
    first_user_snippet: snippet(normalized.firstUserText),
    assistant_tool_calls: toIndexToolCalls(toolCalls),
    concurrency_at_start: concurrencyAtStart,
    error,
  };

  try {
    session.indexWriter.append(entry);
  } catch {
    // ignore index write errors
  }
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
  logger: RequestLogger,
  session: Session
): Promise<void> {
  const timings = new Timings();
  timings.mark("received_at");
  const userAgent = (req.headers["user-agent"] as string | undefined) || undefined;
  const concurrencyAtStart = session.detectionContext.snapshotConcurrency();
  session.detectionContext.enterRequest();

  let normalized: NormalizedRequest | undefined;
  let detection: DetectionResult | undefined;
  let upstreamStatus = 0;
  let stream = false;
  let modelRequestedFinal = "";
  let modelRemappedFinal = "";
  let assistantBodyForIndex: unknown = null;
  let routeKindForIndex: "anthropic" | "openai-shape" = "anthropic";
  let errorForIndex: string | undefined;
  let endpointForIndex = "";

  try {
    const rawBody = await readBody(req);
    const incomingText = rawBody.toString("utf8");
    const incomingJson = parseJSONSafe(incomingText);

    logger.writeRequest({
      url: req.url || "",
      body: incomingJson,
    });

    normalized = normalizeAnthropicRequest(incomingJson, userAgent);
    session.detectionContext.touchConversation(normalized.conversationId);
    detection = runDetectors(normalized, session.detectionContext);

    // Clients (e.g. Claude Code) may add query params like ?beta=true.
    // Strip them for routing decisions, then forward them onto the upstream URL.
    const { path: subPath, query: subQuery } = splitPathQuery(sub);
    const isMessages = subPath.replace(/\/+$/, "") === "/messages";
    endpointForIndex = subPath;

    const originalBody = incomingJson as AnthropicRequest | null;
    const originalModel = originalBody?.model ?? "";
    const remappedModel = originalModel
      ? applyModelRemap(originalModel, route.target.modelsRemapping)
      : originalModel;
    modelRequestedFinal = originalModel;
    modelRemappedFinal = remappedModel;

    let upstreamUrl: string;
    let upstreamBody: unknown;
    stream = Boolean(
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
      routeKindForIndex = "openai-shape";
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

    timings.mark("upstream_sent_at");
    const upstream = await fetch(upstreamUrl, {
      method: req.method || "POST",
      headers: upstreamHeaders,
      body: upstreamBodyText || undefined,
    });

    const upstreamHeadersObj = fetchHeadersToObject(upstream.headers);
    const contentType = upstream.headers.get("content-type") || "";
    upstreamStatus = upstream.status;

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
        if (text.length > 0) timings.mark("upstream_first_byte_at");
        rawAccum += text;
        const out = conv.feed(text);
        if (out) res.write(out);
      }
      timings.mark("upstream_done_at");
      const trailing = conv.end();
      if (trailing) res.write(trailing);
      res.end();
      timings.mark("responded_to_client_at");

      logger.writeRawResponse({
        status: upstream.status,
        headers: upstreamHeadersObj,
        body: rawAccum,
      });
      const finalResp = conv.finalResponse();
      logger.writeResponse({
        status: upstream.status,
        body: finalResp,
      });
      assistantBodyForIndex = finalResp;
      return;
    }

    timings.mark("upstream_first_byte_at");
    const text = await upstream.text();
    timings.mark("upstream_done_at");
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
      timings.mark("responded_to_client_at");
      logger.writeResponse({ status: upstream.status, body: anthResp });
      assistantBodyForIndex = anthResp;
      return;
    }

    // Non-200 or non-messages: pass through.
    res.statusCode = upstream.status;
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json"
    );
    res.end(text);
    timings.mark("responded_to_client_at");
    const parsed = text
      ? contentType.includes("text/event-stream")
        ? parseSSE(text)
        : parseJSONSafe(text)
      : null;
    logger.writeResponse({
      status: upstream.status,
      body: parsed,
    });
    assistantBodyForIndex = parsed;
  } catch (err) {
    errorForIndex = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    session.detectionContext.exitRequest();
    if (!timings.get("responded_to_client_at")) timings.mark("responded_to_client_at");
    try {
      logger.writeMeta(timings.toMeta());
    } catch {
      // ignore meta write errors
    }
    if (normalized && detection) {
      finalizeIndex({
        session,
        timings,
        route: "anthropic",
        normalized,
        detection,
        upstreamStatus,
        stream,
        endpoint: endpointForIndex || sub,
        modelRequested: modelRequestedFinal,
        modelRemapped: modelRemappedFinal,
        assistantBody: assistantBodyForIndex,
        responseShape: "anthropic",
        requestId: logger.requestId,
        concurrencyAtStart,
        error: errorForIndex,
      });
    }
  }
  void routeKindForIndex;
}

/**
 * Build upstream headers for a direct Anthropic request: forwards the client's
 * headers but swaps auth to `x-api-key` and guarantees an `anthropic-version`.
 */
function buildAnthropicForwardHeaders(
  reqHeaders: NodeJS.Dict<string | string[]>,
  apiKey: string
): Record<string, string> {
  const out: Record<string, string> = {};
  let hasVersion = false;
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (key === "authorization" || key === "x-api-key") continue;
    if (key === "anthropic-version") hasVersion = true;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  out["x-api-key"] = apiKey;
  if (!hasVersion) out["anthropic-version"] = "2023-06-01";
  out["Content-Type"] = "application/json";
  return out;
}

/**
 * Direct Anthropic Messages API passthrough (provider: "anthropic").
 *
 * No format conversion — the client speaks Anthropic and so does the upstream.
 * The official @anthropic-ai/sdk handles auth headers, the `/v1/messages`
 * contract, and (for streams) reconstructing the final message for logging.
 */
async function handleAnthropicDirect(
  req: IncomingMessage,
  res: ServerResponse,
  sub: string,
  route: RouteConfig,
  logger: RequestLogger,
  session: Session
): Promise<void> {
  const timings = new Timings();
  timings.mark("received_at");
  const userAgent = (req.headers["user-agent"] as string | undefined) || undefined;
  const concurrencyAtStart = session.detectionContext.snapshotConcurrency();
  session.detectionContext.enterRequest();

  let normalized: NormalizedRequest | undefined;
  let detection: DetectionResult | undefined;
  let upstreamStatus = 0;
  let stream = false;
  let modelRequestedFinal = "";
  let modelRemappedFinal = "";
  let assistantBodyForIndex: unknown = null;
  let errorForIndex: string | undefined;
  let endpointForIndex = "";

  try {
    const rawBody = await readBody(req);
    const incomingText = rawBody.toString("utf8");
    const incomingJson = parseJSONSafe(incomingText);

    logger.writeRequest({ url: req.url || "", body: incomingJson });

    normalized = normalizeAnthropicRequest(incomingJson, userAgent);
    session.detectionContext.touchConversation(normalized.conversationId);
    detection = runDetectors(normalized, session.detectionContext);

    const { path: subPath } = splitPathQuery(sub);
    const isMessages = subPath.replace(/\/+$/, "") === "/messages";
    endpointForIndex = subPath;

    const originalBody =
      incomingJson && typeof incomingJson === "object" && !Array.isArray(incomingJson)
        ? (incomingJson as Record<string, unknown>)
        : null;
    const originalModel =
      originalBody && typeof originalBody.model === "string"
        ? originalBody.model
        : "";
    const remappedModel = originalModel
      ? applyModelRemap(originalModel, route.target.modelsRemapping)
      : originalModel;
    modelRequestedFinal = originalModel;
    modelRemappedFinal = remappedModel;
    stream = Boolean(originalBody && originalBody.stream);

    // Endpoints other than /messages (e.g. /messages/count_tokens, /models):
    // generic Anthropic→Anthropic passthrough — no SDK, no conversion.
    if (!isMessages) {
      const upstreamUrl = joinUrl(route.target.baseUrl, sub);
      const upstreamHeaders = buildAnthropicForwardHeaders(
        req.headers,
        route.target.apiKey
      );
      logger.writeRawRequest({
        url: upstreamUrl,
        method: req.method || "GET",
        headers: upstreamHeaders,
        body: incomingJson ?? null,
      });
      timings.mark("upstream_sent_at");
      const upstream = await fetch(upstreamUrl, {
        method: req.method || "GET",
        headers: upstreamHeaders,
        body: incomingText || undefined,
      });
      timings.mark("upstream_first_byte_at");
      const text = await upstream.text();
      timings.mark("upstream_done_at");
      upstreamStatus = upstream.status;
      const ctype = upstream.headers.get("content-type") || "";
      logger.writeRawResponse({
        status: upstream.status,
        headers: fetchHeadersToObject(upstream.headers),
        body: text || null,
      });
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", ctype || "application/json");
      res.end(text);
      timings.mark("responded_to_client_at");
      const parsed = text
        ? ctype.includes("text/event-stream")
          ? parseSSE(text)
          : parseJSONSafe(text)
        : null;
      logger.writeResponse({ status: upstream.status, body: parsed });
      assistantBodyForIndex = parsed;
      return;
    }

    // /messages → official Anthropic SDK.
    const client = new Anthropic({
      apiKey: route.target.apiKey,
      baseURL: anthropicSdkBaseUrl(route.target.baseUrl),
      fetch: (input, init) => globalThis.fetch(input, init),
      maxRetries: 0,
    });

    // The incoming body is already a valid Anthropic Messages request; only the
    // model is (optionally) remapped. `stream` is set by the SDK call itself.
    const params: Record<string, unknown> = { ...(originalBody ?? {}) };
    if (remappedModel) params.model = remappedModel;
    delete params.stream;

    // Forward client-supplied Anthropic protocol headers; the SDK injects
    // x-api-key and a default anthropic-version on its own.
    const forwardHeaders: Record<string, string> = {};
    const betaHeader = req.headers["anthropic-beta"];
    if (typeof betaHeader === "string") forwardHeaders["anthropic-beta"] = betaHeader;
    const versionHeader = req.headers["anthropic-version"];
    if (typeof versionHeader === "string")
      forwardHeaders["anthropic-version"] = versionHeader;
    const requestOpts =
      Object.keys(forwardHeaders).length > 0
        ? { headers: forwardHeaders }
        : undefined;

    const sdkBaseUrl = anthropicSdkBaseUrl(route.target.baseUrl);
    logger.writeRawRequest({
      url: `${sdkBaseUrl}/v1/messages`,
      method: "POST",
      headers: {
        "x-api-key": route.target.apiKey,
        "anthropic-version": forwardHeaders["anthropic-version"] ?? "2023-06-01",
        "content-type": "application/json",
        ...(forwardHeaders["anthropic-beta"]
          ? { "anthropic-beta": forwardHeaders["anthropic-beta"] }
          : {}),
      },
      body: stream ? { ...params, stream: true } : params,
    });

    timings.mark("upstream_sent_at");

    try {
      if (stream) {
        const sdkStream = client.messages.stream(params as never, requestOpts);
        let rawAccum = "";
        let started = false;
        for await (const event of sdkStream) {
          if (!started) {
            started = true;
            timings.mark("upstream_first_byte_at");
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
          }
          const chunk = serializeAnthropicSSE(event);
          rawAccum += chunk;
          res.write(chunk);
        }
        timings.mark("upstream_done_at");
        res.end();
        timings.mark("responded_to_client_at");

        const finalMessage = await sdkStream.finalMessage();
        upstreamStatus = sdkStream.response?.status ?? 200;
        logger.writeRawResponse({
          status: upstreamStatus,
          headers: sdkStream.response
            ? fetchHeadersToObject(sdkStream.response.headers)
            : {},
          body: rawAccum,
        });
        logger.writeResponse({ status: upstreamStatus, body: finalMessage });
        assistantBodyForIndex = finalMessage;
      } else {
        const { data: message, response } = await client.messages
          .create(params as never, requestOpts)
          .withResponse();
        timings.mark("upstream_first_byte_at");
        timings.mark("upstream_done_at");
        upstreamStatus = response.status;
        logger.writeRawResponse({
          status: response.status,
          headers: fetchHeadersToObject(response.headers),
          body: JSON.stringify(message),
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(message));
        timings.mark("responded_to_client_at");
        logger.writeResponse({ status: response.status, body: message });
        assistantBodyForIndex = message;
      }
    } catch (err) {
      if (err instanceof APIError && typeof err.status === "number") {
        upstreamStatus = err.status;
        const errBody: unknown =
          err.error ?? {
            type: "error",
            error: { type: "api_error", message: err.message },
          };
        timings.mark("upstream_done_at");
        logger.writeRawResponse({
          status: err.status,
          headers: err.headers ? fetchHeadersToObject(err.headers) : {},
          body: JSON.stringify(errBody),
        });
        if (!res.headersSent) {
          res.statusCode = err.status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(errBody));
        } else {
          res.end();
        }
        timings.mark("responded_to_client_at");
        logger.writeResponse({ status: err.status, body: errBody });
        assistantBodyForIndex = errBody;
      } else {
        throw err;
      }
    }
  } catch (err) {
    errorForIndex = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    session.detectionContext.exitRequest();
    if (!timings.get("responded_to_client_at"))
      timings.mark("responded_to_client_at");
    try {
      logger.writeMeta(timings.toMeta());
    } catch {
      // ignore meta write errors
    }
    if (normalized && detection) {
      finalizeIndex({
        session,
        timings,
        route: "anthropic",
        normalized,
        detection,
        upstreamStatus,
        stream,
        endpoint: endpointForIndex || sub,
        modelRequested: modelRequestedFinal,
        modelRemapped: modelRemappedFinal,
        assistantBody: assistantBodyForIndex,
        responseShape: "anthropic",
        requestId: logger.requestId,
        concurrencyAtStart,
        error: errorForIndex,
      });
    }
  }
}

async function handleOpenAI(
  req: IncomingMessage,
  res: ServerResponse,
  sub: string,
  route: RouteConfig,
  logger: RequestLogger,
  session: Session
): Promise<void> {
  const timings = new Timings();
  timings.mark("received_at");
  const userAgent = (req.headers["user-agent"] as string | undefined) || undefined;
  const concurrencyAtStart = session.detectionContext.snapshotConcurrency();
  session.detectionContext.enterRequest();

  let normalized: NormalizedRequest | undefined;
  let detection: DetectionResult | undefined;
  let upstreamStatus = 0;
  let stream = false;
  let modelRequestedFinal = "";
  let modelRemappedFinal = "";
  let assistantBodyForIndex: unknown = null;
  let responseShapeForIndex: "anthropic" | "openai" | "none" = "none";
  let errorForIndex: string | undefined;

  try {
    const rawBody = await readBody(req);
    const incomingText = rawBody.toString("utf8");
    const incomingJson = parseJSONSafe(incomingText);

    logger.writeRequest({
      url: req.url || "",
      body: incomingJson,
    });

    normalized = normalizeOpenAIRequest(incomingJson, userAgent);
    session.detectionContext.touchConversation(normalized.conversationId);
    detection = runDetectors(normalized, session.detectionContext);

    let upstreamBody: unknown = incomingJson;
    if (
      incomingJson &&
      typeof incomingJson === "object" &&
      !Array.isArray(incomingJson)
    ) {
      const obj = { ...(incomingJson as Record<string, unknown>) };
      const m = obj.model;
      if (typeof m === "string") {
        modelRequestedFinal = m;
        obj.model = applyModelRemap(m, route.target.modelsRemapping);
        modelRemappedFinal =
          typeof obj.model === "string" ? obj.model : modelRequestedFinal;
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

    timings.mark("upstream_sent_at");
    const upstream = await fetch(upstreamUrl, {
      method: req.method || "POST",
      headers: upstreamHeaders,
      body: upstreamBodyText || undefined,
    });

    const upstreamHeadersObj = fetchHeadersToObject(upstream.headers);
    const contentType = upstream.headers.get("content-type") || "";
    upstreamStatus = upstream.status;

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
        if (text.length > 0) timings.mark("upstream_first_byte_at");
        rawAccum += text;
        res.write(text);
      }
      timings.mark("upstream_done_at");
      res.end();
      timings.mark("responded_to_client_at");
      logger.writeRawResponse({
        status: upstream.status,
        headers: upstreamHeadersObj,
        body: rawAccum,
      });
      const parsedSSE = parseSSE(rawAccum);
      logger.writeResponse({
        status: upstream.status,
        body: parsedSSE,
      });
      // OpenAI streaming token/tool_call extraction skipped in v1.
      return;
    }

    timings.mark("upstream_first_byte_at");
    const text = await upstream.text();
    timings.mark("upstream_done_at");
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
    timings.mark("responded_to_client_at");
    const parsed = text
      ? contentType.includes("text/event-stream")
        ? parseSSE(text)
        : parseJSONSafe(text)
      : null;
    logger.writeResponse({
      status: upstream.status,
      body: parsed,
    });
    if (upstream.ok && !contentType.includes("text/event-stream")) {
      assistantBodyForIndex = parsed;
      responseShapeForIndex = "openai";
    }
  } catch (err) {
    errorForIndex = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    session.detectionContext.exitRequest();
    if (!timings.get("responded_to_client_at")) timings.mark("responded_to_client_at");
    try {
      logger.writeMeta(timings.toMeta());
    } catch {
      // ignore meta write errors
    }
    if (normalized && detection) {
      finalizeIndex({
        session,
        timings,
        route: "openai",
        normalized,
        detection,
        upstreamStatus,
        stream,
        endpoint: sub,
        modelRequested: modelRequestedFinal,
        modelRemapped: modelRemappedFinal,
        assistantBody: assistantBodyForIndex,
        responseShape: responseShapeForIndex,
        requestId: logger.requestId,
        concurrencyAtStart,
        error: errorForIndex,
      });
    }
  }
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
        if (config.proxy.anthropic.target.provider === "anthropic") {
          await handleAnthropicDirect(
            req, res, a.subPath, config.proxy.anthropic, logger, session
          );
        } else {
          await handleAnthropic(
            req, res, a.subPath, config.proxy.anthropic, logger, session
          );
        }
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
        await handleOpenAI(req, res, o.subPath, config.proxy.openai, logger, session);
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
