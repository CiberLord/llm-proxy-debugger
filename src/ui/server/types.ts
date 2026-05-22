import type { IndexEntry } from "../../server/index/types";
import type { MetaJson } from "../../server/timings";

/** One content block of a chat message or model response. */
export type ContentBlock =
  | { kind: "text"; text: string; thinking?: boolean }
  | { kind: "tool_use"; id?: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId?: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  blocks: ContentBlock[];
}

export interface SystemBlock {
  text: string;
}

export interface ToolDef {
  name: string;
  description?: string;
  schema?: unknown;
}

export interface NormalizedResponseView {
  blocks: ContentBlock[];
  stopReason?: string;
  usage?: Record<string, unknown>;
  error?: string;
}

export interface NormalizedView {
  route: "anthropic" | "openai";
  model: { requested: string; remappedTo: string };
  system: SystemBlock[];
  tools: ToolDef[];
  messages: ChatMessage[];
  response: NormalizedResponseView | null;
}

export interface RequestDetail {
  sessionId: number;
  index: IndexEntry;
  meta: MetaJson | null;
  normalized: NormalizedView;
  raw: {
    request: unknown;
    response: unknown;
    rawRequest: unknown;
    rawResponse: unknown;
  };
}

/** Aggregated info for the sessions list screen. */
export interface SessionSummary {
  id: number;
  startedAt?: string;
  endedAt?: string;
  requestCount: number;
  conversationCount: number;
  models: string[];
  agents: string[];
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  errorCount: number;
}

/** One LLM request rendered as a step of the agentic loop. */
export interface OverviewStep {
  requestId: number;
  turn: number;
  route: "anthropic" | "openai";
  model: string;
  modelRemapped: string;
  status: number;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  ttfbMs?: number;
  tokens: IndexEntry["tokens"];
  toolCalls: { name: string; id?: string }[];
  spawnsSubagent: boolean;
  /** Fraction 0..1 of the whole session span — feeds the time gutter. */
  startFrac: number;
  endFrac: number;
}

/** A conversation (root agent or a subagent) and its steps. */
export interface OverviewNode {
  conversationId: string;
  parentConversationId?: string;
  isSubagent: boolean;
  subagentType?: string;
  detector: string;
  confidence: "strong" | "medium" | "weak";
  firstUserSnippet: string;
  steps: OverviewStep[];
  childGroups: ChildGroup[];
}

/** Children spawned by a conversation, grouped by execution mode. */
export interface ChildGroup {
  mode: "parallel" | "sequential";
  children: OverviewNode[];
}

export interface SessionDetail {
  id: number;
  startedAt?: string;
  endedAt?: string;
  entries: IndexEntry[];
  overview: OverviewNode[];
}
