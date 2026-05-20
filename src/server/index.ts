import config from "../../config";
import { createServer } from "./server";

const server = createServer(config);

server.listen(config.proxy.port, "127.0.0.1", () => {
  const { port } = config.proxy;
  console.log(`Proxy listening on http://localhost:${port}`);
  console.log(`  Anthropic: http://localhost:${port}/${config.proxy.anthropic.local.baseUrl}`);
  console.log(`  OpenAI:    http://localhost:${port}/${config.proxy.openai.local.baseUrl}`);
});
