/** Token in `public/service-worker.js` that the build replaces with the shell's file list. */
export const PRECACHE_PLACEHOLDER = "/* __PRECACHE_URLS__ */ []";
const BUILD_ID_PLACEHOLDER = "__BUILD_ID__";

// The service worker stores index.html itself, under both "./" and "./index.html", and
// must never cache its own script.
const EXCLUDED_FILES = new Set(["index.html", "service-worker.js"]);

/**
 * Every emitted file the service worker must store for the shell to start offline, as
 * scope-relative URLs. index.html names only the entry chunk and stylesheet. The MapLibre
 * worker, like any other chunk, is referenced from JavaScript, so scraping the document
 * alone leaves the map unable to draw anything on an offline cold start.
 */
export function shellPrecacheUrls(files: readonly string[]): string[] {
  return files
    .map((file) => file.split("\\").join("/"))
    .filter((file) => !EXCLUDED_FILES.has(file))
    .sort()
    .map((file) => `./${file.split("/").map(encodeURIComponent).join("/")}`);
}

/** Fills the build id and precache list into the service worker source. */
export function injectShellBuild(source: string, buildId: string, urls: readonly string[]): string {
  // A missing token would otherwise ship a worker that silently caches too little.
  for (const token of [BUILD_ID_PLACEHOLDER, PRECACHE_PLACEHOLDER]) {
    if (!source.includes(token)) throw new Error(`service-worker.js no longer contains ${token}`);
  }
  // Function replacers insert the values verbatim; a string replacement would treat
  // "$&" and similar sequences in a file name as patterns.
  return source
    .replaceAll(BUILD_ID_PLACEHOLDER, () => buildId)
    .replace(PRECACHE_PLACEHOLDER, () => JSON.stringify(urls));
}
