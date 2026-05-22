import { ToggleButton, ToggleButtonGroup, useTheme } from "@heroui/react";

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Light/dark theme switch for the header. Defaults to the light theme. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme("light");
  const current = theme === "dark" ? "dark" : "light";

  return (
    <ToggleButtonGroup
      size="sm"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={new Set([current])}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next) setTheme(String(next));
      }}
      aria-label="Theme"
    >
      <ToggleButton id="light" isIconOnly aria-label="Light theme">
        <SunIcon />
      </ToggleButton>
      <ToggleButton id="dark" isIconOnly aria-label="Dark theme">
        <MoonIcon />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
