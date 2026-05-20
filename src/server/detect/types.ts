export interface NormalizedRequest {
  route: "anthropic" | "openai";
  userAgent?: string;
  systemText: string;
  firstUserText: string;
  toolNamesDeclared: string[];
  model: string;
  /** Pre-computed sha1 of system+firstUser, identifies a single conversation. */
  conversationId: string;
}

export interface DetectionResult {
  conversation_id: string;
  parent_conversation_id?: string;
  is_subagent: boolean;
  subagent_type?: string;
  confidence: "strong" | "medium" | "weak";
  signals: string[];
  detector: string;
  client_app_hint?: string;
}

export interface PendingSubagentSpawn {
  parentConversationId: string;
  expectedSubagentType?: string;
  expiresAt: number;
}

export interface DetectionContext {
  now(): number;
  /** Mapping conv_id → last observed assistant tool_calls (from prior response on same conv). */
  getLastAssistantToolCalls(convId: string): Array<{ name: string; input?: unknown }>;
  /** Active conv ids — any conversation seen within the last few minutes. */
  activeConversations(): string[];
  /** Pending spawns awaiting a child convo to appear (FIFO, oldest first). */
  pendingSpawns(): PendingSubagentSpawn[];
  /** Remove a pending spawn (consumed by a matched child). */
  consumePendingSpawn(spawn: PendingSubagentSpawn): void;
}

export interface Detector {
  readonly name: string;
  match(userAgent: string | undefined): boolean;
  detect(req: NormalizedRequest, ctx: DetectionContext): DetectionResult | null;
}
