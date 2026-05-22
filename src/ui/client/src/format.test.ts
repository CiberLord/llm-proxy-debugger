import { describe, it, expect } from "vitest";
import { fmtDateTime, fmtDuration, fmtTime, fmtTokens } from "./format";

describe("fmtDuration", () => {
  it("formats milliseconds, seconds and minutes", () => {
    expect(fmtDuration(500)).toBe("500ms");
    expect(fmtDuration(1500)).toBe("1.5s");
    expect(fmtDuration(65_000)).toBe("1m 05s");
  });
  it("returns a dash for missing input", () => {
    expect(fmtDuration(undefined)).toBe("—");
  });
});

describe("fmtTokens", () => {
  it("formats compact token counts", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(undefined)).toBe("0");
    expect(fmtTokens(500)).toBe("500");
    expect(fmtTokens(12_500)).toBe("12.5k");
  });
});

describe("fmtTime / fmtDateTime", () => {
  it("returns a dash for missing or invalid input", () => {
    expect(fmtTime(undefined)).toBe("—");
    expect(fmtDateTime("not-a-date")).toBe("—");
  });
  it("formats valid timestamps", () => {
    expect(fmtTime("2026-05-22T10:00:00.000Z")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(fmtDateTime("2026-05-22T10:00:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    );
  });
});
