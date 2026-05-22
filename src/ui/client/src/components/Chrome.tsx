import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Page shell: top bar with brand + breadcrumb, centred content column. */
export function Chrome({
  breadcrumb,
  children,
}: {
  breadcrumb?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
          <Link to="/" className="font-bold text-accent no-underline">
            LLM Proxy Debugger
          </Link>
          {breadcrumb != null && (
            <>
              <span className="text-muted">/</span>
              {breadcrumb}
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}

export function Loading() {
  return <div className="py-12 text-center text-muted">Загрузка…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger bg-danger-soft px-4 py-3 text-danger">
      {message}
    </div>
  );
}
