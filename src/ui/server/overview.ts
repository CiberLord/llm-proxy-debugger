import type { IndexEntry } from "../../server/index/types";
import type { ChildGroup, OverviewNode, OverviewStep } from "./types";

function parseTime(s?: string): number | undefined {
  if (!s) return undefined;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : undefined;
}

function nodeStart(n: OverviewNode): number {
  return n.steps.length ? n.steps[0].startFrac : 0;
}

function nodeEnd(n: OverviewNode): number {
  let end = 0;
  for (const s of n.steps) end = Math.max(end, s.endFrac);
  return end;
}

/**
 * Group sibling subagent conversations by execution overlap.
 * A group with several children that overlap in time is "parallel";
 * a lone child is "sequential".
 */
export function groupChildren(children: OverviewNode[]): ChildGroup[] {
  if (children.length === 0) return [];
  const sorted = [...children].sort((a, b) => nodeStart(a) - nodeStart(b));
  const groups: ChildGroup[] = [];
  let current: OverviewNode[] = [];
  let currentEnd = -Infinity;

  for (const child of sorted) {
    const start = nodeStart(child);
    if (current.length === 0 || start < currentEnd) {
      current.push(child);
      currentEnd = Math.max(currentEnd, nodeEnd(child));
    } else {
      groups.push({ mode: current.length > 1 ? "parallel" : "sequential", children: current });
      current = [child];
      currentEnd = nodeEnd(child);
    }
  }
  if (current.length)
    groups.push({ mode: current.length > 1 ? "parallel" : "sequential", children: current });
  return groups;
}

/**
 * Build the conversation tree for a session: each conversation becomes a node
 * with ordered steps; subagent conversations nest under their parent, grouped
 * into parallel / sequential branches.
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

  const byConv = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    const list = byConv.get(e.conversation_id) ?? [];
    list.push(e);
    byConv.set(e.conversation_id, list);
  }

  const nodes = new Map<string, OverviewNode>();
  for (const [convId, list] of byConv) {
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
        spawnsSubagent: (e.assistant_tool_calls ?? []).some((tc) => tc.name === "Task"),
        startFrac: s !== undefined ? (s - minStart) / span : 0,
        endFrac: en !== undefined ? (en - minStart) / span : 0,
      };
    });
    const first = list[0];
    nodes.set(convId, {
      conversationId: convId,
      parentConversationId: list.find((e) => e.parent_conversation_id)
        ?.parent_conversation_id,
      isSubagent: list.some((e) => e.is_subagent),
      subagentType: list.find((e) => e.subagent_type)?.subagent_type,
      detector: first.detection?.detector ?? "unknown",
      confidence: first.detection?.confidence ?? "weak",
      firstUserSnippet: first.first_user_snippet ?? "",
      steps,
      childGroups: [],
    });
  }

  const roots: OverviewNode[] = [];
  const childrenOf = new Map<string, OverviewNode[]>();
  for (const node of nodes.values()) {
    const parentId = node.parentConversationId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parent !== node) {
      const list = childrenOf.get(parentId!) ?? [];
      list.push(node);
      childrenOf.set(parentId!, list);
    } else {
      roots.push(node);
    }
  }
  for (const node of nodes.values()) {
    node.childGroups = groupChildren(childrenOf.get(node.conversationId) ?? []);
  }

  roots.sort((a, b) => nodeStart(a) - nodeStart(b));
  return roots;
}
