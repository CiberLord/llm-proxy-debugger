import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Run from the project root: `vite --config src/ui/client/vite.config.ts`.
export default defineConfig({
  root: "src/ui/client",
  plugins: [react(), tailwindcss()],
  server: {
    port: 4381,
    proxy: {
      "/api": "http://localhost:4380",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
