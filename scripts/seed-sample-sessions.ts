import * as path from "node:path";
import { buildSampleSessions } from "../tests/ui/fixture";

// Writes a demo session (a root agent spawning two parallel subagents) so the
// UI can be explored without first running the proxy.
const target = path.resolve(process.cwd(), process.argv[2] ?? "sessions");
buildSampleSessions(target);
console.log(`Sample session written to ${target}`);
