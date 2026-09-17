# Chartplotter preprocessing pipeline

This Node/TypeScript project inspects NOAA S-57 exchange sets and validates the
manifest contract consumed by the web application. It is an initial safety
spike: it does **not** yet apply S-57 updates or generate vector tiles.

## Requirements

- Node.js 22.12 or newer
- npm

Install dependencies and run all checks:

```sh
npm install
npm run check
```

## Get data

You can get data from the NOAA S-57 exchange set archive at [https://charts.noaa.gov/ENCs/ENCs.shtml](https://charts.noaa.gov/ENCs/ENCs.shtml)

Example:

```sh
cd data/source/
curl -O https://charts.noaa.gov/ENCs/WI_ENCs.zip
```

## Inspect an exchange set

The inventory command accepts either an extracted exchange-set directory or a
ZIP file. ZIPs are read by directory entry only and are not extracted.

```sh
npm run cli -- inventory ../data/source/WI_ENCs.zip
```

It finds files named as an eight-character S-57 cell plus a three-digit update
number. `.000` is the base cell; `.001` and higher are updates. Output is JSON,
with each cell's files sorted into application order. The command exits nonzero
for duplicate files, an update without its base, a missing update in the
sequence, no detected cells, or an unsupported input.

Passing this inventory check only establishes that the files needed for an
ordered update chain are present. It does not establish that their S-57 content
is valid or that applying the updates succeeds.

## Validate a package manifest

```sh
npm run cli -- validate-manifest examples/package-manifest.v1.json
```

The default schema is `../schema/tile-metadata.schema.json`. A different schema
path can be supplied as the final argument. The example values are illustrative
and are not extracted chart metadata or navigation-grade data.

## Commands

- `npm run cli -- …` runs the development CLI.
- `npm run typecheck` checks strict TypeScript.
- `npm test` runs focused unit tests.
- `npm run build` compiles the CLI into `dist/`.
- `npm run check` runs type checking, tests, and example manifest validation.

The next processing stage should use a proven S-57 implementation (for example,
GDAL/OGR) to apply each cell's update chain in the exact inventory order, then
extract `COALNE`, `DEPARE`, `DEPCNT`, and `SOUNDG` while preserving the shared
schema's provenance, scale, depth-unit, datum, and bounds fields.
