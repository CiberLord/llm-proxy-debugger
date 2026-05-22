import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StepCard } from "./StepCard";
import type { OverviewStep } from "../types";

const step: OverviewStep = {
  requestId: 1,
  turn: 1,
  route: "anthropic",
  model: "claude-sonnet-4-6",
  modelRemapped: "anthropic/claude-sonnet-4.6",
  status: 200,
  startedAt: "2026-05-22T10:00:00.000Z",
  endedAt: "2026-05-22T10:00:02.000Z",
  durationMs: 2000,
  ttfbMs: 300,
  tokens: { input: 1200, output: 90 },
  toolCalls: [{ name: "Task", id: "t1" }],
  spawnsSubagent: true,
  startFrac: 0,
  endFrac: 0.22,
};

describe("StepCard", () => {
  it("renders the step with model, tools and a spawn marker", () => {
    const { container } = render(
      <MemoryRouter>
        <StepCard sessionId={1} step={step} />
      </MemoryRouter>
    );
    expect(container.textContent).toContain("#1");
    expect(container.textContent).toContain("claude-sonnet-4-6");
    expect(container.textContent).toContain("Task");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/session/1/request/1"
    );
    expect(container).toMatchSnapshot();
  });
});
