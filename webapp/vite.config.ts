import { defineConfig } from "vitest/config";

export default defineConfig({
  // maplibre-gl 6 locates its worker via `new URL("./maplibre-gl-worker.mjs", import.meta.url)`.
  // Pre-bundling rewrites import.meta.url to node_modules/.vite/deps, where the worker file
  // does not exist, so serve the package unbundled in dev instead.
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
