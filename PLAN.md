# Chartplotter implementation plan

## Goal

Build an installable, offline-capable web application for recreational and informational viewing of NOAA Electronic Navigational Charts in Wisconsin. The application displays shoreline geometry, depth areas and contours, soundings, and the device's current GPS position.

The application is not an ECDIS and is not certified for navigation.

## Confirmed decisions

- Organize the repository as a small monorepo with separate `pipeline/` and `webapp/` directories.
- Build the web application with strict, framework-free TypeScript.
- Use MapLibre GL JS for vector-map rendering and its mouse/touch gestures.
- Preprocess NOAA S-57 exchange sets outside the browser.
- Package charts for offline use and retain their source, edition, update, scale, units, datum, and coverage metadata.
- Start with Wisconsin NOAA ENC coverage.

## System boundary

```text
NOAA S-57 exchange set
        |
        v
pipeline/ -- validates and applies updates, selects features, creates tiles
        |
        v
chart package -- tiles plus a manifest conforming to schema/
        |
        v
webapp/ -- renders charts, handles GPS and controls, stores packages offline
```

The chart-package contract isolates S-57 details from the web application. The web application must be able to load a conforming package without knowing which converter produced it.

## Milestones

### M0: Repository and contract

- [x] Create the root project structure and contributor instructions.
- [x] Define and validate the first chart-package manifest schema.
- [x] Add independently runnable pipeline and webapp projects.

Acceptance: each project documents its local commands; the manifest example validates against the schema; root checks exercise both projects.

### M1: One-cell processing spike

- [x] Download or accept one NOAA S-57 cell and its sequential updates.
- [x] Verify update ordering and reject missing update sequences.
- [x] Extract coastline (`COALNE`), soundings (`SOUNDG`), depth contours (`DEPCNT`), and depth areas (`DEPARE`).
- [x] Produce a local vector-tile package and conforming manifest.

Acceptance: a repeatable command transforms a pinned fixture or downloaded cell into a package that the webapp can open; provenance and update metadata survive the conversion.

### M2: Core map

- [ ] Render shoreline, depth areas, contours, and soundings from the spike package.
- [x] Support mouse/touch pan, wheel/pinch zoom, and visible pan/zoom controls.
- [x] Show an overscale warning and detect when the map center leaves chart coverage.
- [ ] Select appropriate cells by scale without duplicating overlapping chart features.
- [x] Show chart source, edition/update date, depth units, and vertical datum.

Acceptance: the map remains interactive on desktop and a touch viewport, does not render duplicate overlapping cells, and communicates scale and data age.

### M3: GPS

- [x] Add explicit locate and follow controls using the browser Geolocation API.
- [ ] Display position, accuracy circle, timestamp, and stale-fix state.
- [x] Handle unsupported, denied, unavailable, and timed-out location states.

Acceptance: automated tests cover each location state; stopping follow mode releases the geolocation watch.

### M4: Offline installation

- [ ] Add a web app manifest and service worker.
- [ ] Cache the application shell and selected chart packages.
- [ ] Expose package download, progress, version, update, and removal UI.
- [ ] Define storage-quota and interrupted-download behavior.

Acceptance: an installed application with a downloaded package starts and displays charts with networking disabled.

### M5: Wisconsin coverage and updates

- [ ] Process all cells in the Wisconsin exchange set.
- [ ] Resolve overlapping usage bands and coverage boundaries.
- [ ] Automate NOAA catalog checks and atomic package replacement.
- [ ] Retain the previous verified package if an update fails.

Acceptance: the full package passes schema and integrity checks, update dates are visible, and failed refreshes cannot corrupt the installed package.

### M6: Field readiness

- [ ] Test keyboard and touch accessibility, daylight contrast, and reduced-motion behavior.
- [ ] Measure startup, pan/zoom, tile size, battery use, and storage consumption on representative mobile hardware.
- [ ] Add prominent informational-use wording and NOAA attribution/user-agreement access.
- [ ] Document known limitations, including chart/GPS accuracy and absence of live water levels.

Acceptance: the documented test matrix passes on the agreed browsers/devices and known limitations are visible in the application.

## Initial technical risks

- Correct application of sequential S-57 updates and preservation of metadata.
- S-57 portrayal rules are more complex than feature-to-style mappings; the initial style must not imply ECDIS compliance.
- Dense soundings require scale-dependent filtering for legibility and performance.
- Overlapping cells and usage bands can create duplicate or misleading geometry.
- Browser storage quotas and iOS offline lifecycle behavior may constrain chart-package size.
- Charted depth uses a stated sounding datum and is not current water depth.

## Definition of done

A milestone is complete when its acceptance criteria are demonstrated by repeatable commands or automated tests, relevant documentation is updated, and no generated data or secrets are committed.
