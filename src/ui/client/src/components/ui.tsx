import type { ReactNode } from "react";

/** A collapsible section built on the native <details> element. */
export function Panel({
  title,
  subtitle,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-border bg-surface shadow-surface"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3">
        <span className="text-muted transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="font-semibold">{title}</span>
        {subtitle != null && (
          <span className="text-sm text-muted">{subtitle}</span>
        )}
      </summary>
      <div className="border-t border-separator px-4 py-3">{children}</div>
    </details>
  );
}

/** A compact label / value pair used in headers and cards. */
export function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: ReactNode;
  title?: string;
}) {
  return (
    <div title={title} className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </h2>
  );
}
