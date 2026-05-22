import type { OverviewNode } from "../types";
import { StepCard } from "./StepCard";

function ConversationSection({
  sessionId,
  node,
  index,
}: {
  sessionId: number;
  node: OverviewNode;
  index: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Conversation {index + 1}</span>
        <span className="mono text-xs text-muted">
          {node.detector} · {node.conversationId.slice(0, 8)}
        </span>
        <span className="text-xs text-muted">
          {node.steps.length} {node.steps.length === 1 ? "step" : "steps"}
        </span>
      </div>

      {node.firstUserSnippet && (
        <div className="border-l-2 border-separator pl-2 text-xs italic text-muted">
          “{node.firstUserSnippet}”
        </div>
      )}

      <div className="flex flex-col gap-2">
        {node.steps.map((step) => (
          <StepCard key={step.requestId} sessionId={sessionId} step={step} />
        ))}
      </div>
    </div>
  );
}

/** Renders the session as conversations, each a vertical list of steps. */
export function OverviewTree({
  sessionId,
  roots,
}: {
  sessionId: number;
  roots: OverviewNode[];
}) {
  if (roots.length === 0) {
    return <div className="text-sm text-muted">No requests in this session.</div>;
  }
  return (
    <div className="flex flex-col gap-8">
      {roots.map((node, i) => (
        <ConversationSection
          key={node.conversationId}
          sessionId={sessionId}
          node={node}
          index={i}
        />
      ))}
    </div>
  );
}
