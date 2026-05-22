/**
 * Captures screenshots of the three UI screens with a headless Chromium.
 *
 * The browser binary ships as the `@sparticuz/chromium` npm package, so it is
 * installed by `npm install` — no download from a browser CDN is needed (those
 * are blocked by the environment network policy). Run with `npm run ui:shots`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import sparticuzModule from "@sparticuz/chromium";
import { createUiServer } from "../src/ui/server/api";

const ROOT = process.cwd();
const clientDir = path.join(ROOT, "src/ui/client/dist");
const sessionsDir = path.join(ROOT, "sessions");
const outDir = path.join(ROOT, "screenshots");
const PORT = 4399;

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

interface Shot {
  name: string;
  url: string;
  waitFor: string;
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(clientDir, "index.html"))) {
    fail("Client is not built. Run: npm run ui:build:client");
  }
  if (!fs.existsSync(sessionsDir)) {
    fail("No sessions/ directory. Run: npm run ui:seed");
  }
  fs.mkdirSync(outDir, { recursive: true });

  const server = createUiServer({ sessionsDir, clientDir });
  await new Promise<void>((resolve) =>
    server.listen(PORT, "127.0.0.1", resolve)
  );
  const base = `http://127.0.0.1:${PORT}`;

  // @sparticuz/chromium is a CJS module — unwrap the default export.
  const chromiumPkg =
    (sparticuzModule as unknown as { default?: typeof sparticuzModule })
      .default ?? sparticuzModule;
  const executablePath = await (
    chromiumPkg as unknown as { executablePath: () => Promise<string> }
  ).executablePath();

  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  const shots: Shot[] = [
    { name: "01-sessions", url: "/", waitFor: "text=Sessions" },
    { name: "02-session-overview", url: "/session/1", waitFor: "text=Agentic loop" },
    { name: "03-request-normalized", url: "/session/1/request/1", waitFor: "text=System prompt" },
  ];

  for (const shot of shots) {
    await page.goto(base + shot.url, { waitUntil: "networkidle" });
    await page.waitForSelector(shot.waitFor, { timeout: 10_000 });
    const file = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("saved", path.relative(ROOT, file));
  }

  // Raw-mode view of the request page.
  await page.goto(base + "/session/1/request/1", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Raw" }).click();
  await page.waitForSelector("text=request.json", { timeout: 10_000 });
  const rawFile = path.join(outDir, "04-request-raw.png");
  await page.screenshot({ path: rawFile, fullPage: true });
  console.log("saved", path.relative(ROOT, rawFile));

  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log(`\nDone — screenshots in ${path.relative(ROOT, outDir)}/`);
}

main().catch((err) => fail(String(err)));
