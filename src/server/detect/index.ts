import type { Detector, DetectionContext, DetectionResult, NormalizedRequest } from "./types";
import { ClaudeCodeDetector } from "./claude-code";
import { GenericHeuristicDetector } from "./heuristic";

export { ClaudeCodeDetector, GenericHeuristicDetector };
export { conversationIdFor } from "./conversation-id";
export { RunDetectionContext } from "./context";
export type { Detector, DetectionContext, DetectionResult, NormalizedRequest };

const DETECTORS: Detector[] = [new ClaudeCodeDetector()];
const FALLBACK: Detector = new GenericHeuristicDetector();

export function runDetectors(req: NormalizedRequest, ctx: DetectionContext): DetectionResult {
  for (const d of DETECTORS) {
    if (d.match(req.userAgent)) {
      const result = d.detect(req, ctx);
      if (result) return result;
    }
  }
  return FALLBACK.detect(req, ctx)!;
}
