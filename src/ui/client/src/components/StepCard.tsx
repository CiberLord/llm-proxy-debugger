import { Card } from "@heroui/react";
import { Link } from "react-router-dom";
import type { OverviewStep } from "../types";
import { fmtDuration, fmtTokens } from "../format";
import { RouteChip, StatusChip, TagChip } from "./chips";

/** A thin bar showing where the step sits on the session timeline. */
export function TimeBar({
  startFrac,
  endFrac,
}: {
  startFrac: number;
  endFrac: number;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const left = clamp(startFrac) * 100;
  const width = Math.max(1, (clamp(endFrac) - clamp(startFrac)) * 100);
  return (
    <div
      className="relative h-1.5 w-full rounded bg-surface-tertiary"
      title="position on the session timeline"
    >
      <div
        className="absolute h-full rounded bg-accent"
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </div>
  );
}

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
            <span className="text-xs text-muted">turn {step.turn}</span>
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
            {step.ttfbMs != null && <span>ttfb {fmtDuration(step.ttfbMs)}</span>}
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

          <TimeBar startFrac={step.startFrac} endFrac={step.endFrac} />
        </Card.Content>
      </Card>
    </Link>
  );
}
