import type { Detector, DetectionResult, NormalizedRequest, DetectionContext } from "./types";

export class GenericHeuristicDetector implements Detector {
  readonly name = "heuristic";

  match(_userAgent: string | undefined): boolean {
    return true;
  }

  detect(req: NormalizedRequest, ctx: DetectionContext): DetectionResult {
    const signals: string[] = [];
    const active = ctx.activeConversations().filter((c) => c !== req.conversationId);

    // Weak signal: a brand-new conv appearing while another conv is active
    // may be a parallel subagent.
    if (active.length > 0) {
      signals.push(`active-siblings:${active.length}`);
      return {
        conversation_id: req.conversationId,
        parent_conversation_id: active[active.length - 1],
        is_subagent: true,
        confidence: "weak",
        signals,
        detector: this.name,
        client_app_hint: req.userAgent,
      };
    }

    return {
      conversation_id: req.conversationId,
      is_subagent: false,
      confidence: "weak",
      signals,
      detector: this.name,
      client_app_hint: req.userAgent,
    };
  }
}
