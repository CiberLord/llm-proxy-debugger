export function padRight(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + "…";
}

export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined) return "    -";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m${rem.toFixed(0)}s`;
}

export function fmtTime(iso: string | undefined): string {
  if (!iso) return "-";
  // HH:MM:SS.mmm
  const d = new Date(iso);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds()
  )}.${pad3(d.getMilliseconds())}`;
}

export interface Col {
  header: string;
  width: number;
  align?: "left" | "right";
}

export function tableRender(cols: Col[], rows: string[][]): string {
  const lines: string[] = [];
  const headerRow = cols.map((c) => padOrTrunc(c.header, c.width, c.align)).join("  ");
  lines.push(headerRow);
  lines.push(cols.map((c) => "─".repeat(c.width)).join("  "));
  for (const row of rows) {
    lines.push(
      row.map((cell, i) => padOrTrunc(cell, cols[i].width, cols[i].align)).join("  ")
    );
  }
  return lines.join("\n");
}

function padOrTrunc(s: string, w: number, align: "left" | "right" = "left"): string {
  const t = truncate(s, w);
  if (align === "right") return t.padStart(w, " ");
  return padRight(t, w);
}
