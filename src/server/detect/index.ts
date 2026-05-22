import type { Detector, DetectionContext, DetectionResult, NormalizedRequest } from "./types";
import { ClaudeCodeDetector } from "./claude-code";

export { ClaudeCodeDetector };
export { conversationIdFor } from "./conversation-id";
export { RunDetectionContext } from "./context";
export type { Detector, DetectionContext, DetectionResult, NormalizedRequest };

const DETECTORS: Detector[] = [new ClaudeCodeDetector()];

export function runDetectors(req: NormalizedRequest, ctx: DetectionContext): DetectionResult {
  for (const d of DETECTORS) {
    if (d.match(req.userAgent)) {
      const result = d.detect(req, ctx);
      if (result) return result;
    }
  }
  return {
    conversation_id: req.conversationId,
    is_subagent: false,
    confidence: "weak",
    signals: [],
    detector: "unknown",
    client_app_hint: req.userAgent,
  };
}
