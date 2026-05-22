import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRequest } from "../api";
import { fmtDateTime, fmtDuration } from "../format";
import { useAsync } from "../lib/useAsync";
import type {
  ChatMessage,
  NormalizedView,
  RequestDetail,
  SystemBlock,
  ToolDef,
} from "../types";
import { Chrome, ErrorBox, Loading } from "../components/Chrome";
import { ContentBlocks } from "../components/ContentBlocks";
import { JsonView } from "../components/JsonView";
import { XmlText } from "../components/XmlText";
import { RouteChip, StatusChip, TagChip } from "../components/chips";
import { Panel, SectionTitle, Stat } from "../components/ui";

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "User",
  assistant: "Assistant",
  tool: "Tool result",
};

const ROLE_BORDER: Record<ChatMessage["role"], string> = {
  user: "border-l-sky-500",
  assistant: "border-l-indigo-500",
  tool: "border-l-amber-500",
};

function Header({ detail }: { detail: RequestDetail }) {
  const { index } = detail;
  const t = index.tokens ?? {};
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">Request #{index.request_id}</span>
        <RouteChip route={index.route} />
        <StatusChip status={index.status} />
        {index.stream && <TagChip>stream</TagChip>}
      </div>
      <div className="mono text-sm">
        {index.model_requested}
        {index.model_remapped_to &&
          index.model_remapped_to !== index.model_requested && (
            <span className="text-muted"> → {index.model_remapped_to}</span>
          )}
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
        <Stat label="endpoint" value={index.endpoint} />
        <Stat label="duration" value={fmtDuration(index.duration_ms)} />
        <Stat label="ttfb" value={fmtDuration(index.ttfb_ms)} />
        <Stat label="time" value={fmtDateTime(index.started_at)} />
        <Stat label="input" value={t.input ?? 0} />
        <Stat label="output" value={t.output ?? 0} />
        <Stat label="cache read" value={t.cache_read ?? 0} />
        <Stat label="cache create" value={t.cache_creation ?? 0} />
      </div>
      {index.error && <ErrorBox message={index.error} />}
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "normalized" | "raw";
  onChange: (m: "normalized" | "raw") => void;
}) {
  const opt = (value: "normalized" | "raw", label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
        mode === value
          ? "bg-accent text-accent-foreground"
          : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="mb-5 inline-flex gap-1 rounded-xl border border-border bg-surface p-1">
      {opt("normalized", "Normalized")}
      {opt("raw", "Raw")}
    </div>
  );
}

function SystemPanel({
  blocks,
  open,
  onToggle,
}: {
  blocks: SystemBlock[];
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  if (blocks.length === 0) return null;
  return (
    <Panel
      title="System prompt"
      subtitle={`${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`}
      defaultOpen={false}
      open={open}
      onToggle={onToggle}
    >
      <div className="flex flex-col gap-2">
        {blocks.map((b, i) => (
          <details key={i} className="rounded-lg border border-separator">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Block {i + 1}
              <span className="ml-2 text-xs text-muted">
                {b.text.length} chars
              </span>
            </summary>
            <div className="border-t border-separator px-3 py-2">
              <XmlText text={b.text} />
            </div>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function ToolsPanel({
  tools,
  open,
  onToggle,
}: {
  tools: ToolDef[];
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  if (tools.length === 0) return null;
  return (
    <Panel title="Tools" subtitle={tools.length} defaultOpen={false} open={open} onToggle={onToggle}>
      <div className="flex flex-col gap-2">
        {tools.map((tool, i) => (
          <details key={i} className="rounded-lg border border-separator">
            <summary className="cursor-pointer px-3 py-2">
              <span className="mono text-sm font-semibold text-accent-soft-foreground">
                {tool.name}
              </span>
            </summary>
            <div className="flex flex-col gap-3 border-t border-separator px-3 py-2">
              {tool.description && <XmlText text={tool.description} />}
              {tool.schema !== undefined && (
                <div>
                  <SectionTitle>Input schema</SectionTitle>
                  <JsonView value={tool.schema} defaultDepth={2} />
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </Panel>
  );
}

function MessageRow({
  message,
  current,
  open,
  onToggle,
  toolNameById,
}: {
  message: ChatMessage;
  current: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  toolNameById?: Record<string, string>;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className={`group rounded-lg border border-border border-l-4 ${ROLE_BORDER[message.role]} bg-surface`}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2">
        <span className="text-sm text-muted transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="text-sm font-semibold uppercase tracking-wide text-muted">
          {ROLE_LABEL[message.role]}
        </span>
        {current && <TagChip color="accent">latest</TagChip>}
      </summary>
      <div className="border-t border-separator px-3 py-3">
        <ContentBlocks blocks={message.blocks} toolNameById={toolNameById} />
      </div>
    </details>
  );
}

function NormalizedSection({ view }: { view: NormalizedView }) {
  const lastIndex = view.messages.length - 1;
  const responseIndex = view.messages.length;
  const [systemOpen, setSystemOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set());

  const setOpen = (i: number, isOpen: boolean) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(i);
      else next.delete(i);
      return next;
    });

  const toolNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const msg of view.messages) {
      for (const block of msg.blocks) {
        if (block.kind === "tool_use" && block.id) map[block.id] = block.name;
      }
    }
    return map;
  }, [view.messages]);

  const hasSystem = view.system.length > 0;
  const hasTools = view.tools.length > 0;
  const allIndices = view.messages.map((_, i) => i);
  if (view.response) allIndices.push(responseIndex);
  const allOpen =
    (!hasSystem || systemOpen) &&
    (!hasTools || toolsOpen) &&
    allIndices.length > 0 &&
    openSet.size === allIndices.length;

  const toggleAll = () => {
    const next = !allOpen;
    setSystemOpen(next);
    setToolsOpen(next);
    setOpenSet(next ? new Set(allIndices) : new Set());
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleAll}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <SystemPanel blocks={view.system} open={systemOpen} onToggle={setSystemOpen} />
      <ToolsPanel tools={view.tools} open={toolsOpen} onToggle={setToolsOpen} />

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Messages
        </h2>
        <div className="flex flex-col gap-3">
          {view.messages.length === 0 && (
            <div className="text-sm text-muted">No messages.</div>
          )}
          {view.messages.map((m, i) => (
            <MessageRow
              key={i}
              message={m}
              current={i === lastIndex}
              open={openSet.has(i)}
              onToggle={(o) => setOpen(i, o)}
              toolNameById={toolNameById}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Model response
        </h2>
        {view.response ? (
          <details
            open={openSet.has(responseIndex)}
            onToggle={(e) => setOpen(responseIndex, e.currentTarget.open)}
            className="group rounded-lg border border-accent bg-accent-soft"
          >
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2">
              <span className="text-sm text-muted transition-transform group-open:rotate-90">
                ▶
              </span>
              <span className="text-sm font-semibold uppercase tracking-wide text-muted">
                Model response
              </span>
            </summary>
            <div className="border-t border-separator px-3 py-3">
              {view.response.error && (
                <ErrorBox message={view.response.error} />
              )}
              {view.response.blocks.length > 0 && (
                <ContentBlocks
                  blocks={view.response.blocks}
                  toolNameById={toolNameById}
                />
              )}
              {(view.response.stopReason || view.response.usage) && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-separator pt-2 text-xs text-muted">
                  {view.response.stopReason && (
                    <span>stop: {view.response.stopReason}</span>
                  )}
                  {view.response.usage && (
                    <span className="mono">
                      usage: {JSON.stringify(view.response.usage)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </details>
        ) : (
          <div className="rounded-lg border border-accent bg-accent-soft p-3">
            <div className="text-sm text-muted">No response.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function RawSection({ detail }: { detail: RequestDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="request.json">
        <JsonView value={detail.raw.request} defaultDepth={3} />
      </Panel>
      <Panel title="response.json">
        <JsonView value={detail.raw.response} defaultDepth={3} />
      </Panel>
      <Panel title="raw_request.json" defaultOpen={false}>
        <JsonView value={detail.raw.rawRequest} defaultDepth={2} />
      </Panel>
      <Panel title="raw_response.json" defaultOpen={false}>
        <JsonView value={detail.raw.rawResponse} defaultDepth={2} />
      </Panel>
    </div>
  );
}

export function RequestDetailPage() {
  const { id, reqId } = useParams();
  const sessionId = Number(id);
  const requestId = Number(reqId);
  const [mode, setMode] = useState<"normalized" | "raw">("normalized");
  const { loading, error, data } = useAsync(
    () => fetchRequest(sessionId, requestId),
    [sessionId, requestId]
  );

  return (
    <Chrome
      breadcrumb={
        <span className="flex items-center gap-2">
          <Link to={`/session/${sessionId}`} className="text-accent">
            Session #{sessionId}
          </Link>
          <span className="text-muted">/</span>
          <span>request #{requestId}</span>
        </span>
      }
    >
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <Header detail={data} />
          <ModeToggle mode={mode} onChange={setMode} />
          {mode === "normalized" ? (
            <NormalizedSection view={data.normalized} />
          ) : (
            <RawSection detail={data} />
          )}
        </>
      )}
    </Chrome>
  );
}
