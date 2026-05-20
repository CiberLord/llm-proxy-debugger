import * as fs from "node:fs";
import * as path from "node:path";
import type { IndexEntry } from "./types";

export class IndexWriter {
  readonly path: string;

  constructor(sessionDir: string) {
    this.path = path.join(sessionDir, "index.jsonl");
  }

  append(entry: IndexEntry): void {
    fs.appendFileSync(this.path, JSON.stringify(entry) + "\n");
  }
}

export function readIndex(sessionDir: string): IndexEntry[] {
  const p = path.join(sessionDir, "index.jsonl");
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8");
  const out: IndexEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as IndexEntry);
    } catch {
      // skip malformed
    }
  }
  return out;
}
