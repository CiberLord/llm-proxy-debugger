import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionsPage } from "./SessionsPage";
import type { SessionSummary } from "../types";

const sample: SessionSummary[] = [
  {
    id: 1,
    startedAt: "2026-05-22T10:00:00.000Z",
    endedAt: "2026-05-22T10:00:09.000Z",
    requestCount: 4,
    conversationCount: 3,
    models: ["claude-sonnet-4-6"],
    agents: ["claude-code"],
    tokens: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
    errorCount: 0,
  },
];

afterEach(() => vi.unstubAllGlobals());

describe("SessionsPage", () => {
  it("renders sessions returned by the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => sample }))
    );
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("Session #1")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("shows an empty-state when there are no sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }))
    );
    render(
      <MemoryRouter>
        <SessionsPage />
      </MemoryRouter>
    );
    expect(
      await screen.findByText("No recorded sessions.")
    ).toBeInTheDocument();
  });
});
