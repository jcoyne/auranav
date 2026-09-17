# Chartplotter web application

Framework-free TypeScript user interface for viewing chart packages produced by `pipeline/`. MapLibre GL JS supplies map rendering and its standard pointer, wheel, keyboard, and touch gestures.

The current map uses conspicuously labeled synthetic geometry near Milwaukee. It proves the shell and shared layer vocabulary without presenting invented geometry as NOAA chart data. It must be replaced by a package conforming to `../schema/tile-metadata.schema.json` before chart-display acceptance criteria can pass.

## Commands

Node.js 22.22.2 or newer is required.

From this directory:

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

Or run the corresponding workspace commands from the repository root.

## Structure

- `src/map/` creates the MapLibre map, preview chart layers, and GPS accuracy/position layers.
- `src/gps/` owns the browser geolocation watch and translates browser errors into explicit application states.
- `src/controls/` provides accessible directional pan, zoom, and location-follow buttons.
- `src/ui/` renders chart provenance and visible location status.

## Product constraints

This is a recreational and informational viewer. It is not an ECDIS and is not a substitute for official charts, prudent navigation, or situational awareness. A successful build or visual inspection does not establish navigation-grade correctness.

Location requires a secure browser context (HTTPS, except for localhost) and explicit user permission. The app shows reported GPS accuracy; it does not imply that the position or chart geometry is exact.
