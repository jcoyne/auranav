# AuraNav

AuraNav is an installable, offline-capable web application for viewing NOAA Electronic Navigational Charts around Wisconsin, including depths, shoreline geometry, and navigation lights. It is intended for recreational and informational use and is not a certified Electronic Chart Display and Information System.

The repository contains two independently runnable projects:

- `pipeline/` downloads or accepts NOAA S-57 exchange sets, checks their update sequences, and produces browser-friendly chart packages.
- `webapp/` is a framework-free TypeScript application that displays chart packages and device location with MapLibre GL JS.

Their versioned interface is documented in `schema/`. See `PLAN.md` for milestones and known risks.

## Development

Node.js 22.22.2 or newer is required.

```sh
npm install
npm run check
npm run dev
```

With the generated Wisconsin package present, open `http://localhost:5173/`.
The development server selects `data/packages/wisconsin/manifest.json` by default.

Each project has its own README with local development commands. Downloaded and generated chart data belongs under `data/` and is ignored by Git.

## Deployment

`npm run deploy` builds the application for a site subdirectory and copies it, together with one chart package, into a static site directory:

```sh
npm run deploy
DEPLOY_DEST=/path/to/site/auranav DEPLOY_BASE=/auranav/ DEPLOY_PACKAGE=wisconsin npm run deploy
```

The subdirectory must be baked in at build time, because Vite resolves asset URLs against it and the application registers its service worker under that scope. Production builds have no default chart package, so the script points the viewer at the package copy it deploys alongside the application. The script copies files only; committing and publishing the destination is a separate, deliberate step.

The service worker caches the application shell on install, and a browser only reinstalls a worker whose script bytes changed. The build therefore names the shell cache after a hash of the deployed files, so each deployment invalidates the previous shell. Deployments also retain previously deployed `assets/` files, because a browser still holding an earlier `index.html` keeps requesting the content-hashed assets that document names. Removing them turns an out-of-date shell into a hard failure rather than a page that updates on its next visit. A visitor who already holds the previous shell loads it once more and picks up the new build on the following navigation.

Chart packages are large binary files. Repeated deployments into a Git-backed site permanently grow that repository's history. The hosting origin must serve HTTPS, so that service workers, OPFS, and geolocation are available, and must honour HTTP range requests for PMTiles.

## Safety and source

NOAA ENC data includes charted conditions and metadata whose age and accuracy vary. Displayed depths refer to a chart datum rather than the live water surface. The application must display chart age, units, datum, position accuracy, and its informational-use limitation.
