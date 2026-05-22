import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import type { RequestDetail } from "../types";

const detail: RequestDetail = {
  sessionId: 1,
  index: {
    request_id: 1,
    route: "anthropic",
    endpoint: "/messages",
    status: 200,
    stream: false,
    model_requested: "claude-sonnet-4-6",
    model_remapped_to: "anthropic/claude-sonnet-4.6",
    tokens: { input: 1200, output: 90 },
    conversation_id: "root",
    is_subagent: false,
    detection: { confidence: "strong", signals: [], detector: "claude-code" },
    first_user_snippet: "hello",
    assistant_tool_calls: [],
    concurrency_at_start: 0,
    started_at: "2026-05-22T10:00:00.000Z",
  },
  meta: null,
  normalized: {
    route: "anthropic",
    model: { requested: "claude-sonnet-4-6", remappedTo: "anthropic/claude-sonnet-4.6" },
    system: [{ text: "You are an agent.\n<rules>be nice</rules>" }],
    tools: [{ name: "Read", description: "read a file", schema: { type: "object" } }],
    messages: [{ role: "user", blocks: [{ kind: "text", text: "hello there" }] }],
    response: {
      blocks: [{ kind: "text", text: "hi back" }],
      stopReason: "end_turn",
      usage: { output_tokens: 5 },
    },
  },
  raw: {
    request: { url: "/messages", body: {} },
    response: { status: 200, body: {} },
    rawRequest: {},
    rawResponse: {},
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("RequestDetailPage", () => {
  it("renders the normalized view and toggles to raw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => detail }))
    );
    render(
      <MemoryRouter initialEntries={["/session/1/request/1"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Системный промпт")).toBeInTheDocument();
    expect(screen.getByText("История переписки")).toBeInTheDocument();
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(screen.getByText("hi back")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Raw"));
    expect(await screen.findByText("request.json")).toBeInTheDocument();
    expect(screen.getByText("raw_response.json")).toBeInTheDocument();
  });
});
