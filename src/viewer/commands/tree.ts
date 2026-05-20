import type { IndexEntry } from "../../server/index/types";
import type { ResolvedRun } from "../runs";
import { fmtDuration } from "../format";

interface ConvNode {
  conversationId: string;
  parentConversationId?: string;
  subagentType?: string;
  detector: string;
  confidence: "strong" | "medium" | "weak";
  entries: IndexEntry[];
  children: ConvNode[];
}

export function cmdTree(run: ResolvedRun): string {
  const byConv = new Map<string, ConvNode>();
  for (const e of run.entries) {
    let node = byConv.get(e.conversation_id);
    if (!node) {
      node = {
        conversationId: e.conversation_id,
        parentConversationId: e.parent_conversation_id,
        subagentType: e.subagent_type,
        detector: e.detection.detector,
        confidence: e.detection.confidence,
        entries: [],
        children: [],
      };
      byConv.set(e.conversation_id, node);
    } else {
      // earliest entry that sets a parent wins
      if (!node.parentConversationId && e.parent_conversation_id) {
        node.parentConversationId = e.parent_conversation_id;
      }
      if (!node.subagentType && e.subagent_type) node.subagentType = e.subagent_type;
    }
    node.entries.push(e);
  }

  const roots: ConvNode[] = [];
  for (const node of byConv.values()) {
    if (node.parentConversationId && byConv.has(node.parentConversationId)) {
      byConv.get(node.parentConversationId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const lines: string[] = [];
  lines.push(`Session #${run.sessionId} · conversation tree`);
  lines.push("");
  for (const root of roots) renderNode(root, "", true, true, lines);
  return lines.join("\n") + "\n";
}

function renderNode(
  node: ConvNode,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  out: string[]
): void {
  const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
  const totalDur = node.entries.reduce(
    (s, e) => s + (e.duration_ms ?? 0),
    0
  );
  const reqIds = node.entries.map((e) => `#${e.request_id}`).join(",");
  const label = node.subagentType
    ? `subagent:${node.subagentType}`
    : node.parentConversationId
      ? `subagent (${node.confidence})`
      : `root (${node.detector})`;
  const snippet = node.entries[0]?.first_user_snippet ?? "";
  const continuationPrefix = isRoot ? "" : isLast ? "   " : "│  ";
  out.push(
    `${prefix}${branch}[${node.conversationId.slice(0, 8)}] ${label}  ` +
      `${node.entries.length} req (${reqIds})  ${fmtDuration(totalDur)}` +
      (snippet ? `\n${prefix}${continuationPrefix}  "${snippet}"` : "")
  );

  const childPrefix = prefix + continuationPrefix;
  node.children.forEach((c, i) => {
    renderNode(c, childPrefix, i === node.children.length - 1, false, out);
  });
}
