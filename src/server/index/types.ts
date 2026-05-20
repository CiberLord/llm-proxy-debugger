export interface IndexTokenStats {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_creation?: number;
}

export interface IndexAssistantToolCall {
  name: string;
  id?: string;
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
  assistant_tool_calls: IndexAssistantToolCall[];
  concurrency_at_start: number;
  error?: string;
}
