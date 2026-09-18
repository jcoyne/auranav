import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
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

// A service worker is only reinstalled when its script bytes change, and this one caches
// the application shell on install. Left unversioned, it would keep serving a deployment's
// shell -- and the asset URLs baked into it -- after those assets had been replaced.
// Naming the cache after a hash of the deployed files ties shell invalidation to the build.
function versionServiceWorker(): Plugin {
  let outDir = "";
  return {
    name: "chartplotter:version-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const workerPath = path.join(outDir, "service-worker.js");
      let source: string;
      try {
        source = await readFile(workerPath, "utf8");
      } catch {
        return;
      }
      const hash = createHash("sha256");
      // Hash after the public directory has been copied, so unhashed files such as the
      // glyph ranges and icons also invalidate the cache when they change.
      for (const file of (await readdir(outDir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)))
        .filter((file) => file !== "service-worker.js")
        .sort()) {
        hash.update(file);
        hash.update(await readFile(path.join(outDir, file)));
      }
      await writeFile(workerPath, source.replaceAll("__BUILD_ID__", hash.digest("hex").slice(0, 16)));
    },
  };
}

export default defineConfig({
  plugins: [serveRepoDataDir(), versionServiceWorker()],
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
