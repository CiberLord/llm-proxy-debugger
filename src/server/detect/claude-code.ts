import type { Detector, DetectionResult, NormalizedRequest, DetectionContext, PendingSubagentSpawn } from "./types";

const UA_RE = /^claude-code\//i;

export class ClaudeCodeDetector implements Detector {
  readonly name = "claude-code";

  match(userAgent: string | undefined): boolean {
    return !!userAgent && UA_RE.test(userAgent);
  }

  detect(req: NormalizedRequest, ctx: DetectionContext): DetectionResult {
    const signals = ["ua:claude-code"];

    // Did the parent of any active conversation just emit a Task tool_use?
    // If so, and the incoming convId is *different*, this is a subagent spawn.
    const spawns = ctx.pendingSpawns();
    let matched: PendingSubagentSpawn | undefined;
    for (const s of spawns) {
      if (s.parentConversationId !== req.conversationId) {
        matched = s;
        break;
      }
    }

    if (matched) {
      ctx.consumePendingSpawn(matched);
      signals.push("parent-emitted-task");
      if (matched.expectedSubagentType) signals.push(`subagent_type:${matched.expectedSubagentType}`);
      return {
        conversation_id: req.conversationId,
        parent_conversation_id: matched.parentConversationId,
        is_subagent: true,
        subagent_type: matched.expectedSubagentType,
        confidence: "strong",
        signals,
        detector: this.name,
        client_app_hint: req.userAgent,
      };
    }

    return {
      conversation_id: req.conversationId,
      is_subagent: false,
      confidence: "strong",
      signals,
      detector: this.name,
      client_app_hint: req.userAgent,
    };
  }
}
