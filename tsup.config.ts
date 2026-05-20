import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server/index.ts", "src/viewer/index.ts"],
  format: ["cjs"],
  target: "node18",
  outDir: "dist",
  clean: true,
});
