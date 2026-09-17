# Chart package style contract

The first package format exposes four Mapbox Vector Tile source layers. Property names are stable within schema version 1; additional properties may be added compatibly.

## `coastline`

Line features derived from S-57 `COALNE` objects.

- `cell`: source ENC cell name
- `usageBand`: integer from 1 through 6
- `compilationScale`: source compilation scale denominator

## `depth-area`

Polygon features derived from S-57 `DEPARE` objects.

- `minimumDepth`: shallow bound in metres when known
- `maximumDepth`: deep bound in metres when known
- `cell`, `usageBand`, `compilationScale`

## `depth-contour`

Line features derived from S-57 `DEPCNT` objects.

- `depth`: contour value in metres
- `cell`, `usageBand`, `compilationScale`

## `sounding`

Point features derived from S-57 `SOUNDG` geometry.

- `depth`: sounding value in metres
- `cell`, `usageBand`, `compilationScale`

## Display rules

- Source depth values remain in metres. Unit conversion is a presentation concern.
- A feature must retain its source cell and scale metadata.
- The webapp should prefer the largest-scale suitable coverage and must indicate overscaling.
- Soundings should be filtered by zoom and density rather than rendered at all scales.
- Schema version 1 styling is intentionally simplified and must not be represented as IHO S-52/ECDIS portrayal.
