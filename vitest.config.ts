import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    projects: [
      {
        // Node-side logic: existing proxy/viewer tests + UI server tests.
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        // UI client: React component + browser-side logic tests.
        plugins: [react()],
        test: {
          name: "client",
          environment: "jsdom",
          globals: true,
          include: ["src/ui/client/**/*.test.{ts,tsx}"],
          setupFiles: ["src/ui/client/src/test/setup.ts"],
        },
      },
    ],
  },
});
