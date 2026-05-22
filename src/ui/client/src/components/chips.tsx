import { Chip } from "@heroui/react";

type ChipColor = "accent" | "danger" | "default" | "success" | "warning";

/** HTTP status — green when ok, red on 4xx/5xx. */
export function StatusChip({ status }: { status: number }) {
  const ok = status > 0 && status < 400;
  return (
    <Chip color={ok ? "success" : "danger"} variant="soft" size="sm">
      {status || "—"}
    </Chip>
  );
}

/** API surface the request used. */
export function RouteChip({ route }: { route: "anthropic" | "openai" }) {
  return (
    <Chip color={route === "anthropic" ? "accent" : "default"} variant="soft" size="sm">
      {route}
    </Chip>
  );
}

/** Generic labelled chip. */
export function TagChip({
  children,
  color = "default",
  title,
}: {
  children: React.ReactNode;
  color?: ChipColor;
  title?: string;
}) {
  return (
    <span title={title}>
      <Chip color={color} variant="soft" size="sm">
        {children}
      </Chip>
    </span>
  );
}
