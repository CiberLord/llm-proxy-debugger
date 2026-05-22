import type { IndexEntry } from "../../server/index/types";
import type { OverviewStep } from "./types";

function parseTime(s?: string): number | undefined {
  if (!s) return undefined;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Flat ordered list of all requests in a session, sorted by start time. */
export function buildOverview(entries: IndexEntry[]): OverviewStep[] {
  return [...entries]
    .sort(
      (a, b) =>
        (parseTime(a.started_at) ?? a.request_id) -
        (parseTime(b.started_at) ?? b.request_id)
    )
    .map((e) => ({
      requestId: e.request_id,
      route: e.route,
      model: e.model_requested,
      modelRemapped: e.model_remapped_to,
      status: e.status,
      error: e.error,
      startedAt: e.started_at,
      endedAt: e.ended_at,
      durationMs: e.duration_ms,
      tokens: e.tokens,
      toolCalls: e.assistant_tool_calls ?? [],
    }));
}
