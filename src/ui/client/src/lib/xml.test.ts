import { describe, it, expect } from "vitest";
import { hasTags, parseXml } from "./xml";

describe("parseXml", () => {
  it("returns a single text node for tag-free text", () => {
    expect(parseXml("just text")).toEqual([{ type: "text", value: "just text" }]);
  });

  it("pairs a matched tag into a collapsible element", () => {
    const nodes = parseXml("<rules>be nice</rules>");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: "element",
      name: "rules",
      children: [{ type: "text", value: "be nice" }],
    });
  });

  it("nests matched elements", () => {
    const nodes = parseXml("<a><b>x</b></a>");
    expect(nodes[0]).toMatchObject({ type: "element", name: "a" });
    const a = nodes[0] as Extract<(typeof nodes)[number], { type: "element" }>;
    expect(a.children[0]).toMatchObject({ type: "element", name: "b" });
  });

  it("keeps surrounding text around an element", () => {
    const nodes = parseXml("intro <tag>x</tag> outro");
    expect(nodes.map((n) => n.type)).toEqual(["text", "element", "text"]);
  });

  it("treats a self-closing tag as a standalone tag", () => {
    const nodes = parseXml("line<br/>next");
    expect(nodes[1]).toEqual({
      type: "tag",
      raw: "<br/>",
      name: "br",
      form: "self",
    });
  });

  it("treats an unmatched open tag as a standalone tag", () => {
    const nodes = parseXml("<open>tail");
    expect(nodes[0]).toMatchObject({ type: "tag", name: "open", form: "open" });
    expect(nodes[1]).toEqual({ type: "text", value: "tail" });
  });

  it("treats an unmatched close tag as a standalone tag", () => {
    const nodes = parseXml("body</close>");
    expect(nodes[1]).toMatchObject({ type: "tag", name: "close", form: "close" });
  });
});

describe("hasTags", () => {
  it("detects presence of tags", () => {
    expect(hasTags("plain")).toBe(false);
    expect(hasTags("a <b> c")).toBe(true);
  });
});
