import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConfidenceChip, RouteChip, StatusChip, TagChip } from "./chips";

describe("chips", () => {
  it("renders status, confidence, route and tag chips", () => {
    const { container } = render(
      <>
        <StatusChip status={200} />
        <StatusChip status={429} />
        <ConfidenceChip confidence="strong" />
        <ConfidenceChip confidence="weak" />
        <RouteChip route="anthropic" />
        <TagChip color="accent">Task</TagChip>
      </>
    );
    expect(container.textContent).toContain("200");
    expect(container.textContent).toContain("strong");
    expect(container.textContent).toContain("anthropic");
    expect(container).toMatchSnapshot();
  });
});
