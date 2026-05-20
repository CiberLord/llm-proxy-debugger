import type { ResolvedRun } from "../runs";
import { fmtDuration, fmtTime, padRight, truncate } from "../format";

const BAR_WIDTH = 60;

export function cmdTimeline(run: ResolvedRun): string {
  const items = run.entries
    .map((e) => ({
      entry: e,
      start: e.started_at ? Date.parse(e.started_at) : NaN,
      end: e.ended_at ? Date.parse(e.ended_at) : NaN,
    }))
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));

  if (items.length === 0) {
    return `Session #${run.sessionId} · no timing data\n`;
  }

  const minStart = Math.min(...items.map((x) => x.start));
  const maxEnd = Math.max(...items.map((x) => x.end));
  const span = Math.max(1, maxEnd - minStart);

  const lines: string[] = [];
  lines.push(
    `Session #${run.sessionId} · timeline · ${fmtTime(
      new Date(minStart).toISOString()
    )} → ${fmtTime(new Date(maxEnd).toISOString())} (span ${fmtDuration(
      maxEnd - minStart
    )})`
  );
  lines.push("");

  for (const { entry, start, end } of items) {
    const startOffset = ((start - minStart) / span) * BAR_WIDTH;
    const endOffset = ((end - minStart) / span) * BAR_WIDTH;
    const bar = renderBar(startOffset, endOffset, BAR_WIDTH);
    const label = entry.is_subagent
      ? `↳ ${entry.subagent_type ?? "subagent"}`
      : entry.detection.detector;
    lines.push(
      `${padRight("#" + entry.request_id, 4)} ` +
        `${bar} ` +
        `${padRight(fmtDuration(end - start), 7)} ` +
        `${entry.conversation_id.slice(0, 8)}  ` +
        truncate(label, 22)
    );
  }
  return lines.join("\n") + "\n";
}

function renderBar(startF: number, endF: number, width: number): string {
  const s = Math.max(0, Math.floor(startF));
  const e = Math.max(s + 1, Math.ceil(endF));
  const clampedEnd = Math.min(e, width);
  const before = " ".repeat(s);
  const filled = "█".repeat(Math.max(1, clampedEnd - s));
  const after = " ".repeat(Math.max(0, width - clampedEnd));
  return `|${before}${filled}${after}|`;
}
