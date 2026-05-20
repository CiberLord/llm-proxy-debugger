import { readRequestFile, type ResolvedRun } from "../runs";

export function cmdShow(run: ResolvedRun, reqIdRaw: string): string {
  const reqId = Number(reqIdRaw);
  if (!Number.isFinite(reqId)) throw new Error(`Invalid request id: ${reqIdRaw}`);
  const entry = run.entries.find((e) => e.request_id === reqId);
  const out: string[] = [];
  out.push(`=== Session #${run.sessionId} · Request #${reqId} ===`);
  if (entry) {
    out.push("");
    out.push("# index entry");
    out.push(JSON.stringify(entry, null, 2));
  }
  for (const file of ["meta.json", "request.json", "response.json"]) {
    const body = readRequestFile(run.sessionDir, reqId, file);
    if (body === null) continue;
    out.push("");
    out.push(`# ${file}`);
    out.push(JSON.stringify(body, null, 2));
  }
  return out.join("\n") + "\n";
}
