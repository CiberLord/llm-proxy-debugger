import type { IndexEntry } from "../../server/index/types";
import type { OverviewNode, OverviewStep } from "./types";

function parseTime(s?: string): number | undefined {
  if (!s) return undefined;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build the session overview: requests grouped by `conversation_id`, each
 * conversation's steps ordered by start time, conversations ordered by their
 * first step. `conversation_id` is a recorded field, so this involves no
 * guessing about agent topology.
 */
export function buildOverview(entries: IndexEntry[]): OverviewNode[] {
  const starts = entries
    .map((e) => parseTime(e.started_at))
    .filter((n): n is number => n !== undefined);
  const ends = entries
    .map((e) => parseTime(e.ended_at))
    .filter((n): n is number => n !== undefined);
  const minStart = starts.length ? Math.min(...starts) : 0;
  const maxEnd = ends.length ? Math.max(...ends) : minStart + 1;
  const span = Math.max(1, maxEnd - minStart);

  const byConversation = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    const list = byConversation.get(e.conversation_id) ?? [];
    list.push(e);
    byConversation.set(e.conversation_id, list);
  }

  const nodes: OverviewNode[] = [];
  for (const [conversationId, list] of byConversation) {
    list.sort(
      (a, b) =>
        (parseTime(a.started_at) ?? a.request_id) -
        (parseTime(b.started_at) ?? b.request_id)
    );
    const steps: OverviewStep[] = list.map((e, i) => {
      const s = parseTime(e.started_at);
      const en = parseTime(e.ended_at);
      return {
        requestId: e.request_id,
        turn: i + 1,
        route: e.route,
        model: e.model_requested,
        modelRemapped: e.model_remapped_to,
        status: e.status,
        error: e.error,
        startedAt: e.started_at,
        endedAt: e.ended_at,
        durationMs: e.duration_ms,
        ttfbMs: e.ttfb_ms,
        tokens: e.tokens,
        toolCalls: e.assistant_tool_calls ?? [],
        startFrac: s !== undefined ? (s - minStart) / span : 0,
        endFrac: en !== undefined ? (en - minStart) / span : 0,
      };
    });
    nodes.push({
      conversationId,
      detector: list[0].detection?.detector ?? "unknown",
      firstUserSnippet: list[0].first_user_snippet ?? "",
      steps,
    });
  }

  nodes.sort(
    (a, b) => (a.steps[0]?.startFrac ?? 0) - (b.steps[0]?.startFrac ?? 0)
  );
  return nodes;
}
