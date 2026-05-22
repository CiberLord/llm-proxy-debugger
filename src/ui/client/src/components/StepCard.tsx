import { Card } from "@heroui/react";
import { Link } from "react-router-dom";
import type { OverviewStep } from "../types";
import { fmtDuration, fmtTokens } from "../format";
import { RouteChip, StatusChip, TagChip } from "./chips";

/** One step of the agentic loop = one LLM request. */
export function StepCard({
  sessionId,
  step,
}: {
  sessionId: number;
  step: OverviewStep;
}) {
  const tokens = step.tokens ?? {};
  const remapped =
    step.modelRemapped && step.modelRemapped !== step.model
      ? step.modelRemapped
      : null;

  return (
    <Link
      to={`/session/${sessionId}/request/${step.requestId}`}
      className="block no-underline"
      data-testid="step-card"
    >
      <Card variant="default" className="transition hover:shadow-overlay">
        <Card.Content className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-sm font-bold">#{step.requestId}</span>
            <RouteChip route={step.route} />
            <StatusChip status={step.status} />
            {step.error && <TagChip color="danger">error</TagChip>}
          </div>

          <div className="mono text-sm">
            {step.model || "—"}
            {remapped && <span className="text-muted"> → {remapped}</span>}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{fmtDuration(step.durationMs)}</span>
            <span>
              ↑{fmtTokens(tokens.input)} ↓{fmtTokens(tokens.output)}
            </span>
          </div>

          {step.toolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {step.toolCalls.slice(0, 6).map((tc, i) => (
                <TagChip key={i}>{tc.name}</TagChip>
              ))}
              {step.toolCalls.length > 6 && (
                <span className="text-xs text-muted">
                  +{step.toolCalls.length - 6}
                </span>
              )}
            </div>
          )}

        </Card.Content>
      </Card>
    </Link>
  );
}
