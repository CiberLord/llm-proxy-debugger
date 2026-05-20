#!/usr/bin/env node
import { resolveSessionsDir, resolveRun, listRuns } from "./runs";
import { cmdList } from "./commands/list";
import { cmdShow } from "./commands/show";
import { cmdTree } from "./commands/tree";
import { cmdTimeline } from "./commands/timeline";

interface ParsedArgs {
  command?: string;
  positional: string[];
  sessionsDir?: string;
  run?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sessions" || a === "-s") {
      out.sessionsDir = argv[++i];
    } else if (a.startsWith("--sessions=")) {
      out.sessionsDir = a.slice("--sessions=".length);
    } else if (a === "--run" || a === "-r") {
      out.run = argv[++i];
    } else if (a.startsWith("--run=")) {
      out.run = a.slice("--run=".length);
    } else if (a === "-h" || a === "--help") {
      out.command = out.command ?? "help";
    } else if (!out.command) {
      out.command = a;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

const USAGE = `prox-view — inspect LLM proxy sessions

Usage:
  prox-view list                    show requests in the latest run
  prox-view show <req#>             dump meta/request/response for one request
  prox-view tree                    group requests by conversation_id, show subagent links
  prox-view timeline                ASCII gantt of request durations
  prox-view runs                    list all runs in the sessions dir

Options:
  --sessions <dir>   sessions directory (default: \$PROX_SESSIONS_DIR or ./sessions)
  --run <id|latest>  pick a specific run (default: latest)
`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  const sessionsDir = resolveSessionsDir(args.sessionsDir);

  if (args.command === "runs") {
    const runs = listRuns(sessionsDir);
    if (runs.length === 0) {
      process.stdout.write(`No runs in ${sessionsDir}\n`);
      return;
    }
    process.stdout.write(`Runs in ${sessionsDir}:\n`);
    for (const r of runs) process.stdout.write(`  ${r}\n`);
    return;
  }

  const run = resolveRun(sessionsDir, args.run);

  switch (args.command) {
    case "list":
      process.stdout.write(cmdList(run));
      return;
    case "show": {
      const reqId = args.positional[0];
      if (!reqId) throw new Error("usage: prox-view show <req#>");
      process.stdout.write(cmdShow(run, reqId));
      return;
    }
    case "tree":
      process.stdout.write(cmdTree(run));
      return;
    case "timeline":
      process.stdout.write(cmdTimeline(run));
      return;
    default:
      process.stderr.write(`unknown command: ${args.command}\n${USAGE}`);
      process.exit(2);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
}
