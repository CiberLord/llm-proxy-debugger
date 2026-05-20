import { tableRender, fmtDuration, truncate, type Col } from "../format";
import type { ResolvedRun } from "../runs";

export function cmdList(run: ResolvedRun): string {
  const cols: Col[] = [
    { header: "#", width: 4, align: "right" },
    { header: "route", width: 9 },
    { header: "endpoint", width: 18 },
    { header: "model", width: 22 },
    { header: "dur", width: 8, align: "right" },
    { header: "tok in/out", width: 12, align: "right" },
    { header: "conv", width: 10 },
    { header: "kind", width: 26 },
  ];

  const rows: string[][] = run.entries.map((e) => {
    const tok = `${e.tokens.input ?? "-"}/${e.tokens.output ?? "-"}`;
    let kind = "";
    if (e.is_subagent) {
      kind = `subagent${e.subagent_type ? `:${e.subagent_type}` : ""} (${e.detection.confidence})`;
    } else {
      kind = `root (${e.detection.detector})`;
    }
    const stream = e.stream ? " ●" : "";
    return [
      String(e.request_id),
      e.route + (e.status >= 400 ? "!" : ""),
      truncate(e.endpoint, 18),
      truncate(e.model_remapped_to || e.model_requested, 22),
      fmtDuration(e.duration_ms) + stream,
      tok,
      e.conversation_id.slice(0, 8),
      kind,
    ];
  });

  const header = `Session #${run.sessionId} · ${run.entries.length} requests · ${run.sessionDir}`;
  return header + "\n\n" + tableRender(cols, rows) + "\n";
}
