import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const repoDataDir = fileURLToPath(new URL("../data/", import.meta.url));

// Generated chart packages live in the repository's `data/` directory, outside this Vite
// root, so requests for `/data/...` would otherwise fall through to the SPA index.html.
// Rewriting to `/@fs/` reuses Vite's static middleware, which honours the HTTP range
// requests that PMTiles archives depend on.
function serveRepoDataDir(): Plugin {
  return {
    name: "chartplotter:serve-repo-data-dir",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [urlPath = "", query] = (req.url ?? "").split("?");
        if (urlPath.startsWith("/data/")) {
          const target = path.resolve(repoDataDir, decodeURIComponent(urlPath.slice("/data/".length)));
          // Keep traversal such as `/data/../package.json` out of the mount.
          if (target.startsWith(repoDataDir)) {
            req.url = `/@fs${encodeURI(target)}${query ? `?${query}` : ""}`;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [serveRepoDataDir()],
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
