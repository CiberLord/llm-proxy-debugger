import type { OverviewNode } from "../types";
import { ConfidenceChip } from "./chips";
import { StepCard } from "./StepCard";

function NodeView({
  sessionId,
  node,
}: {
  sessionId: number;
  node: OverviewNode;
}) {
  const isSub = node.isSubagent || !!node.subagentType;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {isSub ? (
          <span className="font-semibold text-accent">
            ↳ {node.subagentType || "субагент"}
          </span>
        ) : (
          <span className="font-semibold">корневой агент</span>
        )}
        <ConfidenceChip confidence={node.confidence} />
        <span className="mono text-xs text-muted">
          {node.detector} · {node.conversationId.slice(0, 8)}
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

      {node.childGroups.map((group, gi) => (
        <div
          key={gi}
          className="ml-3 flex flex-col gap-2 border-l-2 border-accent pl-4"
        >
          {group.mode === "parallel" ? (
            <>
              <div className="text-xs font-semibold text-accent">
                ‖ параллельный запуск ×{group.children.length}
              </div>
              <div className="flex flex-wrap items-start gap-3">
                {group.children.map((child) => (
                  <div
                    key={child.conversationId}
                    className="min-w-[260px] flex-1"
                  >
                    <NodeView sessionId={sessionId} node={child} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-muted">
                → последовательный субагент
              </div>
              {group.children.map((child) => (
                <NodeView
                  key={child.conversationId}
                  sessionId={sessionId}
                  node={child}
                />
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Renders the session as a vertical tree of agentic-loop steps. */
export function OverviewTree({
  sessionId,
  roots,
}: {
  sessionId: number;
  roots: OverviewNode[];
}) {
  if (roots.length === 0) {
    return <div className="text-sm text-muted">Нет запросов в сессии.</div>;
  }
  return (
    <div className="flex flex-col gap-8">
      {roots.map((root) => (
        <NodeView key={root.conversationId} sessionId={sessionId} node={root} />
      ))}
    </div>
  );
}
