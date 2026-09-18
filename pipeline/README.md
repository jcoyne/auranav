# AuraNav preprocessing pipeline

This Node/TypeScript project inspects NOAA S-57 exchange sets, converts extracted
cells into PMTiles, and validates the manifest consumed by the web app.

## Requirements

- Node.js 22.12 or newer
- npm
- GDAL/OGR with the S-57 and PMTiles vector drivers (`ogrinfo` and `ogr2ogr`)

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
unzip WI_ENCs.zip
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

## Convert one extracted cell

Keep the base `.000` file and every sequential `.001`, `.002`, … update beside
one another. Supply the NOAA archive's `USERAGREEMENT.TXT` as the user agreement:

```sh
npm run cli -- convert-cell \
  ../data/source/WI_ENCs/ENC_ROOT/US4WI1DP/US4WI1DP.000 \
  --output ../data/packages/us4wi1dp \
  --package-id wisconsin-us4wi1dp \
  --name "NOAA ENC US4WI1DP" \
  --source-url https://charts.noaa.gov/ENCs/WI_ENCs.zip \
  --retrieved-at 2026-09-17T12:00:00Z \
  --user-agreement ../data/source/WI_ENCs/ENC_ROOT/USERAGREEMENT.TXT
```

The command applies updates through GDAL, splits multipoint `SOUNDG` features,
adds each sounding's `DEPTH`, and stages whichever of `COALNE`, `DEPARE`,
`DEPCNT`, `SOUNDG`, and `LIGHTS` are present under stable names in a temporary
GeoPackage. The stable `light` layer preserves the S-57 light attributes as
`color`, `characteristic`, `signalGroup`, `periodSeconds`, `heightMetres`,
`nominalRangeNm`, `category`, and `status`. Enumeration and list values remain
the raw S-57 codes so the browser can apply chart-style abbreviations without
discarding source information. Sector and directional context is retained as
`sectorStart`, `sectorEnd`, `orientation`, and `heightDatum` even when it is not
part of the short on-chart label.
It also writes the cell's exact positive `M_COVR` geometry as the stable
`coverage` layer. S-57 `CATCOV=2` polygons identify areas where coverage is not
available and are deliberately excluded; NOAA's positive `CATCOV=1` geometry
already bounds the charted area around them.
Individual ENC cells are not required to contain every supported feature class.
GDAL's native PMTiles driver creates the archive. The final directory also contains a schema-v1
`manifest.json` and `USER_AGREEMENT.txt`.

Conversion refuses incomplete update sequences, an applied DSID update number
that differs from the highest update file, empty or malformed present layers,
missing `M_COVR` coverage, a cell with no supported chart layers, absent DSID/DSPM metadata, non-metre source depths, non-metre light heights, an
invalid generated PMTiles layer set, and an existing output directory. Output
is published only after all checks pass. Coverage bounds are calculated from
the same positive `M_COVR` features written to the archive, rather than the
rectangular extent of every `M_COVR` record.
The manifest preserves edition, update number and dates, compilation scale,
vertical and sounding datums, source URL, and retrieval time.

## Convert an extracted exchange set

The batch command accepts an already extracted exchange-set directory, converts
its valid cells in inventory order, and publishes one top-level manifest with a
separate PMTiles tile set for each cell:

```sh
npm run cli -- convert-exchange-set \
  ../data/source/WI_ENCs/ENC_ROOT \
  --output ../data/packages/wisconsin \
  --package-id wisconsin-enc \
  --name "Wisconsin NOAA ENCs" \
  --source-url https://charts.noaa.gov/ENCs/WI_ENCs.zip \
  --retrieved-at 2026-09-17T12:00:00Z \
  --user-agreement ../data/source/WI_ENCs/ENC_ROOT/USERAGREEMENT.TXT
```

`--limit N` converts only the first N cells in sorted inventory order and is
useful for smoke tests. Up to four cells convert concurrently by default;
`--jobs N` sets a limit from 1 through 16. The final output directory is renamed into place only
after every selected cell converts and the combined manifest validates. A
failure removes all staged output. The command currently requires an extracted
directory; ZIP input remains supported by `inventory` only. S-57 cells whose
edition is `0` are cancellation records and are intentionally omitted from the
published package.

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

Multi-cell packaging is implemented, while web display selection across
overlapping usage bands and automated NOAA refreshes remain later work.
Successful conversion does not establish navigation-grade correctness.
