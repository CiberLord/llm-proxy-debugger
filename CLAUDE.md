# CLAUDE.md

## Project Overview

**llm-proxy-debugger** is a local HTTP proxy that intercepts and logs all requests/responses between LLM coding agents (Claude Code, OpenCode) and their upstream AI APIs. It provides a web dashboard for visualizing recorded sessions.

**Request flow**: Client → Proxy (logs to disk) → Upstream AI API → Client

## Repository Structure

```
├── config.ts                    # Runtime configuration (loaded from .env)
├── src/
│   ├── server/                  # Core proxy server
│   │   ├── index.ts             # Entry point (starts HTTP server)
│   │   ├── server.ts            # Main HTTP handler (~1000 lines)
│   │   ├── session.ts           # Disk logging (Session, RequestLogger)
│   │   ├── instrument.ts        # Request normalization
│   │   ├── remap.ts             # Glob-pattern model name remapping
│   │   ├── timings.ts           # Request lifecycle timing
│   │   ├── anthropic-sdk.ts     # Official Anthropic SDK integration
│   │   ├── converter/           # Anthropic ↔ OpenAI format converters
│   │   │   ├── anthropic-to-openai.ts
│   │   │   ├── openai-to-anthropic.ts
│   │   │   └── stream.ts        # SSE stream event conversion
│   │   ├── detect/              # Client app detection & conversation tracking
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── context.ts
│   │   │   ├── conversation-id.ts
│   │   │   ├── claude-code.ts
│   │   │   └── heuristic.ts
│   │   └── index/               # Fast request index for UI
│   │       ├── types.ts
│   │       └── writer.ts
│   └── ui/
│       ├── server/              # Express API server for dashboard
│       │   ├── index.ts
│       │   ├── api.ts           # REST endpoints
│       │   ├── data.ts          # Session data loading
│       │   ├── normalize.ts     # Data normalization for UI
│       │   ├── overview.ts      # Conversation tree building
│       │   └── types.ts
│       └── client/              # React frontend (Vite)
│           ├── src/
│           │   ├── App.tsx      # Router
│           │   ├── pages/       # SessionsPage, SessionOverviewPage, RequestDetailPage
│           │   ├── components/  # StepCard, Chrome, JsonView, XmlText, OverviewTree
│           │   ├── lib/         # xml.ts, useAsync.ts
│           │   ├── format.ts    # Date/duration formatting
│           │   └── api.ts       # Fetch calls to UI server
│           └── vite.config.ts
├── tests/                       # Vitest test suite (node environment)
│   ├── e2e.test.ts
│   ├── server.test.ts
│   ├── converter/
│   ├── detect.test.ts
│   ├── ui/
│   └── ...
└── scripts/
    ├── seed-sample-sessions.ts  # Generate sample data for UI dev
    └── screenshot-ui.ts         # Headless browser screenshots
```

## Commands

```bash
# Development
npm run test          # Run all tests (vitest, one-shot)
npm run test:watch    # Tests in watch mode

# Running
npm run start         # Build (tsup) + run proxy on port 4344
npm run ui            # Build client + start UI dashboard on port 4380
npm run ui:dev        # UI in dev mode (hot reload, concurrently)

# Utilities
npm run ui:seed       # Seed sample session data
npm run ui:shots      # Generate headless browser screenshots
```

## Configuration

Copy `.env.example` to `.env` and fill in values:

```
PROXY_PORT=4344

# `openai-compatible` (default): convert Anthropic↔OpenAI Chat Completions
# `anthropic`: talk directly to Anthropic Messages API (no conversion)
ANTHROPIC_TARGET_PROVIDER=openai-compatible
ANTHROPIC_TARGET_BASE_URL=https://...
ANTHROPIC_API_KEY=<required>

OPENAI_TARGET_BASE_URL=https://...
OPENAI_API_KEY=<required>
```

`config.ts` validates required env vars at startup and throws if missing. The two proxy routes are:
- `http://localhost:4344/anthropic/v1` → upstream Anthropic-compatible endpoint
- `http://localhost:4344/openai/v1` → upstream OpenAI-compatible endpoint

## Architecture

### Two Provider Modes

The Anthropic route supports two modes controlled by `ANTHROPIC_TARGET_PROVIDER`:

1. **`openai-compatible`** (default): Converts Anthropic Messages API requests to OpenAI Chat Completions format before forwarding. Used for OpenRouter-style providers. Model names are remapped via glob patterns (e.g. `*sonnet*` → `anthropic/claude-sonnet-4.6`).

2. **`anthropic`**: Uses the official `@anthropic-ai/sdk` to forward requests directly to the Anthropic API without format conversion. Model remapping is disabled.

### Disk Logging

Each server run creates a session directory: `sessions/<session-id>/`

Each request is logged to `sessions/<session-id>/requests/<n>/` with:
- `request.json` — normalized request (model, messages, tools, etc.)
- `raw_request.json` — raw JSON body received
- `response.json` — normalized response (content, usage, stop_reason)
- `raw_response.json` — raw response (or reconstructed from stream)
- `meta.json` — timings, client detection, conversation ID

An `index.jsonl` is maintained per session for fast UI loading without reading all request files.

### Format Converters (`src/server/converter/`)

- `anthropicToOpenAI(req)`: Converts Anthropic Messages request → OpenAI Chat Completions request. Handles tools, system prompts, message roles, image content.
- `openAIToAnthropicResponse(res)`: Converts OpenAI response → Anthropic Messages response.
- `stream.ts`: Converts SSE event streams between the two formats.

### Model Remapping (`src/server/remap.ts`)

`remapModel(model, remapping)` applies a `Record<string, string>` mapping where:
- Exact matches take priority over patterns
- Patterns support `*` glob wildcard
- If no match, original model name is returned unchanged

### Client Detection (`src/server/detect/`)

`DetectionContext` maintains state across requests in a session:
- Identifies client apps (Claude Code, OpenCode, custom agents) from request headers and patterns
- Computes `conversationId` as SHA1 of (system prompt + first user message)
- Tracks parent-child conversation flows for subagent relationships

### UI Dashboard

- **Sessions list** (`/`): All recorded sessions with counts
- **Session overview** (`/sessions/:id`): Conversation tree with timings
- **Request detail** (`/sessions/:id/requests/:n`): Full request+response with JSON/XML viewers

UI server REST API:
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/requests/:n`

## Testing

Tests use **Vitest** with two projects:

- **`node`** (`tests/**/*.test.ts`): Runs in Node.js environment. E2E tests start a real proxy on a random port and mock `globalThis.fetch` to intercept upstream calls. No network access needed.
- **`client`** (`src/ui/client/**/*.test.{ts,tsx}`): Runs in jsdom environment. React component tests with `@testing-library/react`.

Key testing patterns:
- Tests mock `globalThis.fetch` for upstream calls; use `realFetch` to call the proxy
- `sdk/openai` clients point at `http://localhost:<port>/anthropic/v1` or `/openai/v1`
- Snapshot tests in `src/ui/client/` for visual regression
- Real session directories are created in `tests/` tmpdir and cleaned up after

## Code Conventions

- **TypeScript strict mode** throughout — no `any` unless unavoidable
- **Class-based** for stateful modules (`Session`, `RequestLogger`, `IndexWriter`, `DetectionContext`)
- **Functional** for converters and pure transforms
- **Type-first**: interfaces defined before implementations
- **No comments** on obvious code; comments reserved for non-obvious constraints or workarounds
- **Error handling**: `try/finally` for cleanup; errors in request handling are caught and returned as HTTP 500
- JSON files written with 2-space indentation (`JSON.stringify(data, null, 2)`)
- `void` used to suppress unused-promise warnings on fire-and-forget calls

## Build System

- **`tsup`**: Builds `src/server/index.ts` and `src/ui/server/index.ts` → `dist/` (CommonJS, Node 18 target)
- **`vite`**: Builds React client (`src/ui/client/`) → static assets served by UI server
- **`tsx`**: Used for scripts (`scripts/`) via `npm run ui:seed`, `npm run ui:shots`
- TypeScript target: ES2020, module: CommonJS

## Key Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Direct Anthropic API integration (provider=anthropic mode) |
| `openai` | OpenAI SDK (used in tests) |
| `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible` | Vercel AI SDK adapters (used in tests) |
| `react` + `react-router-dom` | UI frontend |
| `@heroui/react` | UI component library |
| `dotenv` | Environment variable loading |
| `vitest` | Test runner |
| `playwright` | Headless browser for screenshot script |

## Common Workflows

### Add a new proxy feature
1. Modify `src/server/server.ts` for request handling logic
2. Add/update types in `src/server/index/types.ts` if changing logged data
3. Update `src/server/session.ts` if new files need to be written per request
4. Add tests in `tests/` mirroring existing e2e patterns

### Add a new UI page or component
1. Add component under `src/ui/client/src/components/` or `pages/`
2. Wire route in `src/ui/client/src/App.tsx`
3. Add API endpoint in `src/ui/server/api.ts` if new data is needed
4. Run `npm run ui:dev` to iterate with hot reload

### Add a format converter test
1. Mirror existing tests in `tests/converter/`
2. Call converter functions directly — no server needed
3. Use snapshot assertions for complex output structures

### Seed and inspect the UI locally
```bash
npm run ui:seed   # creates sessions/sample-* directories
npm run ui        # build + serve at http://localhost:4380
```
