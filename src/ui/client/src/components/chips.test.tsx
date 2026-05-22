import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RouteChip, StatusChip, TagChip } from "./chips";

describe("chips", () => {
  it("renders status, route and tag chips", () => {
    const { container } = render(
      <>
        <StatusChip status={200} />
        <StatusChip status={429} />
        <RouteChip route="anthropic" />
        <TagChip color="accent">Task</TagChip>
      </>
    );
    expect(container.textContent).toContain("200");
    expect(container.textContent).toContain("429");
    expect(container.textContent).toContain("anthropic");
    expect(container).toMatchSnapshot();
  });
});
