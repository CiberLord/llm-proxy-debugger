import type {
  DetectionContext,
  PendingSubagentSpawn,
} from "./types";

const ACTIVITY_TTL_MS = 10 * 60 * 1000;
const SPAWN_TTL_MS = 5 * 60 * 1000;

interface ConvState {
  lastSeenAt: number;
  lastAssistantToolCalls: Array<{ name: string; input?: unknown }>;
}

export class RunDetectionContext implements DetectionContext {
  private conversations = new Map<string, ConvState>();
  private spawns: PendingSubagentSpawn[] = [];
  private clock: () => number;
  private inflight = 0;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  now(): number {
    return this.clock();
  }

  /** Mark conversation observed. Called at request entry. */
  touchConversation(convId: string): void {
    const existing = this.conversations.get(convId);
    if (existing) {
      existing.lastSeenAt = this.clock();
    } else {
      this.conversations.set(convId, {
        lastSeenAt: this.clock(),
        lastAssistantToolCalls: [],
      });
    }
    this.gc();
  }

  /** Record the assistant's tool_use blocks (parsed from the response we just sent). */
  noteAssistantToolCalls(
    convId: string,
    toolCalls: Array<{ name: string; input?: unknown }>
  ): void {
    const state = this.conversations.get(convId);
    if (state) state.lastAssistantToolCalls = toolCalls;
  }

  getLastAssistantToolCalls(
    convId: string
  ): Array<{ name: string; input?: unknown }> {
    return this.conversations.get(convId)?.lastAssistantToolCalls ?? [];
  }

  activeConversations(): string[] {
    const now = this.clock();
    const out: string[] = [];
    for (const [id, st] of this.conversations.entries()) {
      if (now - st.lastSeenAt < ACTIVITY_TTL_MS) out.push(id);
    }
    return out;
  }

  registerPendingSpawn(parentConvId: string, expectedSubagentType?: string): void {
    this.spawns.push({
      parentConversationId: parentConvId,
      expectedSubagentType,
      expiresAt: this.clock() + SPAWN_TTL_MS,
    });
  }

  pendingSpawns(): PendingSubagentSpawn[] {
    const now = this.clock();
    this.spawns = this.spawns.filter((s) => s.expiresAt > now);
    return [...this.spawns];
  }

  consumePendingSpawn(spawn: PendingSubagentSpawn): void {
    const i = this.spawns.indexOf(spawn);
    if (i >= 0) this.spawns.splice(i, 1);
  }

  /** Number of currently in-flight requests, not counting the one about to start. */
  snapshotConcurrency(): number {
    return this.inflight;
  }

  enterRequest(): void {
    this.inflight += 1;
  }

  exitRequest(): void {
    if (this.inflight > 0) this.inflight -= 1;
  }

  private gc(): void {
    const now = this.clock();
    for (const [id, st] of this.conversations.entries()) {
      if (now - st.lastSeenAt > ACTIVITY_TTL_MS) this.conversations.delete(id);
    }
    this.spawns = this.spawns.filter((s) => s.expiresAt > now);
  }
}
