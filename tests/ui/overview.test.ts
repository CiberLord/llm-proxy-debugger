import { describe, it, expect } from "vitest";
import { buildOverview, groupChildren } from "../../src/ui/server/overview";
import type { OverviewNode } from "../../src/ui/server/types";
import { sampleRequests } from "./fixture";

function node(id: string, startFrac: number, endFrac: number): OverviewNode {
  return {
    conversationId: id,
    isSubagent: true,
    detector: "claude-code",
    confidence: "strong",
    firstUserSnippet: "",
    steps: [
      {
        requestId: 1,
        turn: 1,
        route: "anthropic",
        model: "m",
        modelRemapped: "m",
        status: 200,
        tokens: {},
        toolCalls: [],
        spawnsSubagent: false,
        startFrac,
        endFrac,
      },
    ],
    childGroups: [],
  };
}

describe("groupChildren", () => {
  it("groups time-overlapping children into one parallel group", () => {
    const groups = groupChildren([node("a", 0.1, 0.6), node("b", 0.2, 0.7)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mode).toBe("parallel");
    expect(groups[0].children.map((c) => c.conversationId)).toEqual(["a", "b"]);
  });

  it("keeps non-overlapping children as separate sequential groups", () => {
    const groups = groupChildren([node("a", 0.0, 0.2), node("b", 0.5, 0.7)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.mode === "sequential")).toBe(true);
  });
});

describe("buildOverview", () => {
  it("builds a root with two steps and a parallel subagent group", () => {
    const entries = sampleRequests().map((r) => r.index);
    const roots = buildOverview(entries);

    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root.conversationId).toBe("root");
    expect(root.steps.map((s) => s.requestId)).toEqual([1, 4]);
    expect(root.steps[0].spawnsSubagent).toBe(true);

    expect(root.childGroups).toHaveLength(1);
    const group = root.childGroups[0];
    expect(group.mode).toBe("parallel");
    expect(group.children.map((c) => c.subagentType)).toEqual(["Explore", "Explore"]);
  });

  it("computes timeline fractions within [0,1]", () => {
    const roots = buildOverview(sampleRequests().map((r) => r.index));
    for (const step of roots[0].steps) {
      expect(step.startFrac).toBeGreaterThanOrEqual(0);
      expect(step.endFrac).toBeLessThanOrEqual(1);
    }
  });
});
