import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRECACHE_PLACEHOLDER, injectShellBuild, shellPrecacheUrls } from "./shell-precache";

describe("shellPrecacheUrls", () => {
  it("includes assets that index.html does not name, such as the MapLibre worker", () => {
    expect(shellPrecacheUrls([
      "assets/index-abc.js",
      "assets/maplibre-gl-worker-def.js",
      "assets/index-ghi.css",
    ])).toEqual([
      "./assets/index-abc.js",
      "./assets/index-ghi.css",
      "./assets/maplibre-gl-worker-def.js",
    ]);
  });

  it("leaves out index.html and the service worker itself", () => {
    expect(shellPrecacheUrls(["index.html", "service-worker.js", "app-icon.svg"])).toEqual(["./app-icon.svg"]);
  });

  it("normalizes Windows separators and encodes each path segment", () => {
    expect(shellPrecacheUrls(["fonts\\Noto Sans Regular\\0-255.pbf"]))
      .toEqual(["./fonts/Noto%20Sans%20Regular/0-255.pbf"]);
  });
});

describe("injectShellBuild", () => {
  const source = `const SHELL_CACHE = "shell-__BUILD_ID__";\nconst BUILD_ASSETS = ${PRECACHE_PLACEHOLDER};`;

  it("replaces the build id and the precache list", () => {
    expect(injectShellBuild(source, "1234", ["./assets/a.js"]))
      .toBe(`const SHELL_CACHE = "shell-1234";\nconst BUILD_ASSETS = ["./assets/a.js"];`);
  });

  it("inserts the list verbatim when a URL contains replacement patterns", () => {
    expect(injectShellBuild(source, "1234", ["./$&.js", "./$'.js"]))
      .toBe(`const SHELL_CACHE = "shell-1234";\nconst BUILD_ASSETS = ["./$&.js","./$'.js"];`);
  });

  it("fails the build when a token is missing", () => {
    expect(() => injectShellBuild("const SHELL_CACHE = 'x';", "1234", [])).toThrow("__BUILD_ID__");
    expect(() => injectShellBuild("__BUILD_ID__", "1234", [])).toThrow("__PRECACHE_URLS__");
  });

  it("matches the tokens in the real service worker", () => {
    // jsdom replaces the global URL, which node:fs rejects, so resolve from the path string.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const worker = readFileSync(path.join(here, "../../public/service-worker.js"), "utf8");
    expect(() => injectShellBuild(worker, "1234", [])).not.toThrow();
  });
});
