import { describe, it, expect } from "vitest";
import { buildOverview } from "../../src/ui/server/overview";
import { sampleRequests } from "./fixture";

describe("buildOverview", () => {
  it("returns all requests sorted by start time", () => {
    const steps = buildOverview(sampleRequests().map((r) => r.index));
    expect(steps.map((s) => s.requestId)).toEqual([1, 2, 3, 4]);
  });

  it("maps fields correctly", () => {
    const steps = buildOverview(sampleRequests().map((r) => r.index));
    expect(steps[0].model).toBe("claude-sonnet-4-6");
    expect(steps[0].status).toBe(200);
    expect(steps[0].toolCalls.map((t) => t.name)).toEqual(["Task", "Task"]);
  });

  it("returns an empty list for no entries", () => {
    expect(buildOverview([])).toEqual([]);
  });
});
