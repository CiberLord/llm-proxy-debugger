import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { XmlText } from "./XmlText";

describe("XmlText", () => {
  it("renders matched tags as a collapsible element", () => {
    const { container } = render(
      <XmlText text={"intro\n<rules>\n  be careful\n</rules>\ntail"} />
    );
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container).toMatchSnapshot();
  });

  it("renders plain text without disclosure elements", () => {
    const { container } = render(<XmlText text="just plain text" />);
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(container).toMatchSnapshot();
  });
});
