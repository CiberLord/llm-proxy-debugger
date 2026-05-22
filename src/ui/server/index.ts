import * as path from "node:path";
import { createUiServer } from "./api";

function resolveSessionsDir(): string {
  const env = process.env.PROX_SESSIONS_DIR;
  return env ? path.resolve(env) : path.resolve(process.cwd(), "sessions");
}

function resolveClientDir(): string {
  const env = process.env.UI_CLIENT_DIR;
  return env
    ? path.resolve(env)
    : path.resolve(process.cwd(), "src/ui/client/dist");
}

const sessionsDir = resolveSessionsDir();
const clientDir = resolveClientDir();
const port = Number(process.env.UI_PORT ?? 4380);

const server = createUiServer({ sessionsDir, clientDir });
server.listen(port, "127.0.0.1", () => {
  console.log(`llm-proxy-debugger UI → http://localhost:${port}`);
  console.log(`  sessions: ${sessionsDir}`);
  console.log(`  client:   ${clientDir}`);
});
