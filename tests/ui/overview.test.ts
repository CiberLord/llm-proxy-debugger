import { describe, it, expect } from "vitest";
import { buildOverview } from "../../src/ui/server/overview";
import { sampleRequests } from "./fixture";

describe("buildOverview", () => {
  it("groups requests by conversation, ordered by first step", () => {
    const nodes = buildOverview(sampleRequests().map((r) => r.index));
    expect(nodes.map((n) => n.conversationId)).toEqual(["root", "subA", "subB"]);
    expect(nodes[0].steps.map((s) => s.requestId)).toEqual([1, 4]);
    expect(nodes[1].steps).toHaveLength(1);
    expect(nodes[2].steps).toHaveLength(1);
  });

  it("numbers turns within a conversation", () => {
    const nodes = buildOverview(sampleRequests().map((r) => r.index));
    expect(nodes[0].steps.map((s) => s.turn)).toEqual([1, 2]);
  });

  it("computes timeline fractions within [0,1]", () => {
    const nodes = buildOverview(sampleRequests().map((r) => r.index));
    for (const node of nodes) {
      for (const step of node.steps) {
        expect(step.startFrac).toBeGreaterThanOrEqual(0);
        expect(step.endFrac).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns an empty list for no entries", () => {
    expect(buildOverview([])).toEqual([]);
  });
});
