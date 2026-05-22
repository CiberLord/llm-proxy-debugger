import { useMemo, type ReactNode } from "react";
import { parseXml, type XmlNode } from "../lib/xml";

function Tag({ raw }: { raw: string }) {
  return <span className="font-semibold text-accent">{raw}</span>;
}

function render(nodes: XmlNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}.${i}`;
    if (node.type === "text") {
      return <span key={key}>{node.value}</span>;
    }
    if (node.type === "tag") {
      return <Tag key={key} raw={node.raw} />;
    }
    return (
      <details key={key} open className="xml-el">
        <summary className="cursor-pointer">
          <Tag raw={node.openRaw} />
        </summary>
        {render(node.children, key)}
        <Tag raw={node.closeRaw} />
      </details>
    );
  });
}

/**
 * Renders text with XML-tag highlighting and collapsible matched tag pairs,
 * preserving whitespace so prompts read as formatted text — never one-line.
 */
export function XmlText({ text }: { text: string }) {
  const nodes = useMemo(() => parseXml(text), [text]);
  return (
    <div className="mono whitespace-pre-wrap break-words text-[13px] leading-relaxed">
      {render(nodes, "x")}
    </div>
  );
}
