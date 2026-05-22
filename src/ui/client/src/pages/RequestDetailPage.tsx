import { useState } from "react";
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

const ROLE_STYLE: Record<
  ChatMessage["role"],
  { dot: string; borderL: string }
> = {
  user: { dot: "bg-sky-500", borderL: "border-l-sky-500" },
  assistant: { dot: "bg-indigo-500", borderL: "border-l-indigo-500" },
  tool: { dot: "bg-amber-500", borderL: "border-l-amber-500" },
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

function SystemPanel({ blocks }: { blocks: SystemBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <Panel
      title="System prompt"
      subtitle={`${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}`}
    >
      <div className="flex flex-col gap-2">
        {blocks.map((b, i) => (
          <details
            key={i}
            open={i === 0}
            className="rounded-lg border border-separator"
          >
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

function ToolsPanel({ tools }: { tools: ToolDef[] }) {
  if (tools.length === 0) return null;
  return (
    <Panel title="Tools" subtitle={tools.length}>
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
}: {
  message: ChatMessage;
  current: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const style = ROLE_STYLE[message.role];
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className={`rounded-lg border border-border border-l-4 ${style.borderL} bg-surface ${
        current ? "ring-2 ring-accent" : ""
      }`}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {ROLE_LABEL[message.role]}
        </span>
        {current && <TagChip color="accent">current turn</TagChip>}
      </summary>
      <div className="border-t border-separator px-3 py-3">
        <ContentBlocks blocks={message.blocks} />
      </div>
    </details>
  );
}

function NormalizedSection({ view }: { view: NormalizedView }) {
  const lastIndex = view.messages.length - 1;
  const responseIndex = view.messages.length;
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set());

  const setOpen = (i: number, isOpen: boolean) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(i);
      else next.delete(i);
      return next;
    });

  const allIndices = view.messages.map((_, i) => i);
  if (view.response) allIndices.push(responseIndex);
  const allOpen =
    allIndices.length > 0 && openSet.size === allIndices.length;
  const toggleAll = () =>
    setOpenSet(allOpen ? new Set() : new Set(allIndices));

  return (
    <div className="flex flex-col gap-5">
      <SystemPanel blocks={view.system} />
      <ToolsPanel tools={view.tools} />

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Transcript
          </h2>
          {allIndices.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
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
            />
          ))}
        </div>
      </div>

      <div>
        {view.response ? (
          <details
            open={openSet.has(responseIndex)}
            onToggle={(e) => setOpen(responseIndex, e.currentTarget.open)}
            className="rounded-lg border border-accent bg-accent-soft ring-2 ring-accent"
          >
            <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Model response · current turn
              </span>
            </summary>
            <div className="border-t border-separator px-3 py-3">
              {view.response.error && (
                <ErrorBox message={view.response.error} />
              )}
              {view.response.blocks.length > 0 && (
                <ContentBlocks blocks={view.response.blocks} />
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
          <>
            <SectionTitle>Model response · current turn</SectionTitle>
            <div className="rounded-lg border border-accent bg-accent-soft p-3 ring-2 ring-accent">
              <div className="text-sm text-muted">No response.</div>
            </div>
          </>
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
