function Primitive({ value }: { value: unknown }) {
  if (typeof value === "string")
    return <span className="text-success break-words">"{value}"</span>;
  if (typeof value === "number")
    return <span className="text-accent">{String(value)}</span>;
  if (typeof value === "boolean")
    return <span className="text-warning">{String(value)}</span>;
  if (value === null || value === undefined)
    return <span className="text-muted">null</span>;
  return <span>{String(value)}</span>;
}

function Key({ name }: { name: string }) {
  return <span className="text-accent-soft-foreground">{name}</span>;
}

function Node({
  name,
  value,
  depth,
  defaultDepth,
}: {
  name?: string;
  value: unknown;
  depth: number;
  defaultDepth: number;
}) {
  const isContainer = !!value && typeof value === "object";
  if (!isContainer) {
    return (
      <div className="py-0.5">
        {name !== undefined && (
          <>
            <Key name={name} />
            <span className="text-muted">: </span>
          </>
        )}
        <Primitive value={value} />
      </div>
    );
  }
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const brace = Array.isArray(value)
    ? `[${entries.length}]`
    : `{${entries.length}}`;

  if (entries.length === 0) {
    return (
      <div className="py-0.5">
        {name !== undefined && (
          <>
            <Key name={name} />
            <span className="text-muted">: </span>
          </>
        )}
        <span className="text-muted">{brace}</span>
      </div>
    );
  }

  return (
    <details open={depth < defaultDepth} className="py-0.5">
      <summary className="cursor-pointer">
        {name !== undefined ? <Key name={name} /> : <span className="text-muted">root</span>}
        <span className="text-muted"> {brace}</span>
      </summary>
      <div className="ml-2 border-l border-separator pl-3">
        {entries.map(([k, v]) => (
          <Node
            key={k}
            name={k}
            value={v}
            depth={depth + 1}
            defaultDepth={defaultDepth}
          />
        ))}
      </div>
    </details>
  );
}

/** A collapsible, colour-coded tree view of any JSON value. */
export function JsonView({
  value,
  defaultDepth = 2,
}: {
  value: unknown;
  defaultDepth?: number;
}) {
  return (
    <div className="mono text-[13px] leading-relaxed">
      <Node value={value} depth={0} defaultDepth={defaultDepth} />
    </div>
  );
}
