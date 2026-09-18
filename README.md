# Chartplotter

Chartplotter is an installable, offline-capable web application for viewing NOAA Electronic Navigational Charts around Wisconsin, including depths, shoreline geometry, and navigation lights. It is intended for recreational and informational use and is not a certified Electronic Chart Display and Information System.

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

## Safety and source

NOAA ENC data includes charted conditions and metadata whose age and accuracy vary. Displayed depths refer to a chart datum rather than the live water surface. The application must display chart age, units, datum, position accuracy, and its informational-use limitation.
