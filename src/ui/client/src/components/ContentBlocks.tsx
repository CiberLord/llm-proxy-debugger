import type { ContentBlock } from "../types";
import { CopyButton } from "./CopyButton";
import { JsonView } from "./JsonView";
import { XmlText } from "./XmlText";

function Block({
  block,
  toolNameById,
}: {
  block: ContentBlock;
  toolNameById?: Record<string, string>;
}) {
  if (block.kind === "text") {
    return (
      <div className="relative">
        {block.thinking && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            thinking
          </div>
        )}
        <XmlText text={block.text} />
        <CopyButton text={block.text} />
      </div>
    );
  }

  if (block.kind === "tool_use") {
    return (
      <div className="relative rounded-lg border border-border bg-accent-soft p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span>🔧 tool_use</span>
          <span className="mono text-accent-soft-foreground">{block.name}</span>
          {block.id && <span className="mono text-xs text-muted">{block.id}</span>}
        </div>
        <JsonView value={block.input} defaultDepth={3} />
        <CopyButton text={JSON.stringify(block.input, null, 2)} />
      </div>
    );
  }

  return (
    <details
      open
      className={`relative rounded-lg border p-3 ${
        block.isError
          ? "border-danger bg-danger-soft"
          : "border-border bg-surface-secondary"
      }`}
    >
      <summary className="cursor-pointer text-sm font-semibold">
        ↩ tool_result{" "}
        {block.isError && <span className="text-danger">(error)</span>}
        {block.toolUseId && toolNameById?.[block.toolUseId] && (
          <span className="mono ml-2 text-xs text-accent-soft-foreground">
            {toolNameById[block.toolUseId]}
          </span>
        )}
        {block.toolUseId && (
          <span className="mono ml-2 text-xs text-muted">{block.toolUseId}</span>
        )}
      </summary>
      <div className="mt-2">
        <XmlText text={block.content} />
      </div>
      <CopyButton text={block.content} />
    </details>
  );
}

/** Renders a list of content blocks (text / tool_use / tool_result). */
export function ContentBlocks({
  blocks,
  toolNameById,
}: {
  blocks: ContentBlock[];
  toolNameById?: Record<string, string>;
}) {
  if (blocks.length === 0) {
    return <div className="text-sm italic text-muted">(empty)</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => (
        <Block key={i} block={block} toolNameById={toolNameById} />
      ))}
    </div>
  );
}
