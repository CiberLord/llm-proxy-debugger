// View-model types — kept in sync with src/ui/server/types.ts.

export interface IndexTokenStats {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_creation?: number;
}

export interface IndexEntry {
  request_id: number;
  route: "anthropic" | "openai";
  endpoint: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  ttfb_ms?: number;
  status: number;
  stream: boolean;
  model_requested: string;
  model_remapped_to: string;
  user_agent?: string;
  client_app_hint?: string;
  tokens: IndexTokenStats;
  conversation_id: string;
  parent_conversation_id?: string;
  is_subagent: boolean;
  subagent_type?: string;
  detection: {
    confidence: "strong" | "medium" | "weak";
    signals: string[];
    detector: string;
  };
  first_user_snippet: string;
  assistant_tool_calls: { name: string; id?: string }[];
  concurrency_at_start: number;
  error?: string;
}

export interface MetaJson {
  received_at?: string;
  upstream_sent_at?: string;
  upstream_first_byte_at?: string;
  upstream_done_at?: string;
  responded_to_client_at?: string;
  duration_ms?: number;
  ttfb_ms?: number;
  upstream_duration_ms?: number;
}

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
  tokens: IndexTokenStats;
  toolCalls: { name: string; id?: string }[];
  spawnsSubagent: boolean;
  startFrac: number;
  endFrac: number;
}

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
