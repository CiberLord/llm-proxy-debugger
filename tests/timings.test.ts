import { describe, it, expect } from "vitest";
import { Timings } from "../src/server/timings";

describe("Timings", () => {
  it("captures marks and computes derived durations", () => {
    let now = 1000;
    const t = new Timings(() => now);
    t.mark("received_at");
    now = 1010;
    t.mark("upstream_sent_at");
    now = 1050;
    t.mark("upstream_first_byte_at");
    now = 1200;
    t.mark("upstream_done_at");
    now = 1210;
    t.mark("responded_to_client_at");

    const meta = t.toMeta();
    expect(meta.duration_ms).toBe(210);
    expect(meta.ttfb_ms).toBe(40);
    expect(meta.upstream_duration_ms).toBe(190);
    expect(meta.received_at).toBe(new Date(1000).toISOString());
    expect(meta.responded_to_client_at).toBe(new Date(1210).toISOString());
  });

  it("omits derived values when marks missing", () => {
    let now = 0;
    const t = new Timings(() => now);
    t.mark("received_at");
    now = 50;
    t.mark("responded_to_client_at");
    const meta = t.toMeta();
    expect(meta.duration_ms).toBe(50);
    expect(meta.ttfb_ms).toBeUndefined();
    expect(meta.upstream_duration_ms).toBeUndefined();
  });

  it("ignores duplicate marks (first wins)", () => {
    let now = 100;
    const t = new Timings(() => now);
    t.mark("received_at");
    now = 200;
    t.mark("received_at"); // should be ignored
    expect(t.get("received_at")).toBe(100);
  });
});
