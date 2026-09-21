# Chart package style contract

The first package format exposes a set of Mapbox Vector Tile source layers. Property names are stable within schema version 1; additional properties may be added compatibly.

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

## `land-area`

Polygon features derived from S-57 `LNDARE` objects. `LNDARE` point and line primitives are excluded because a fill cannot draw them.

- `name`: `OBJNAM` when the landform is named, otherwise absent
- `cell`, `usageBand`, `compilationScale`

## `land-label`

Point features, one per distinct landform name in a cell, derived from the named `LNDARE` and `LNDRGN` objects. Each anchor lies on its landform, so a landform spanning several tiles is labelled once rather than once per tile. Two distinct landforms sharing a name within one cell share a single anchor.

- `name`: `OBJNAM`, always present
- `spanDegrees`: the larger of the landform's bounding-box width and height in degrees, floored at 0.005
- `cell`, `usageBand`, `compilationScale`

## Display rules

- Source depth values remain in metres. Unit conversion is a presentation concern.
- A feature must retain its source cell and scale metadata.
- The webapp should prefer the largest-scale suitable coverage and must indicate overscaling.
- Soundings should be filtered by zoom and density rather than rendered at all scales.
- Landform labels should appear only in the zoom band where the landform is legible at screen size, using `spanDegrees`, so mainland labels do not persist at every scale.
- Sounding and light labels take collision priority over landform labels.
- Schema version 1 styling is intentionally simplified and must not be represented as IHO S-52/ECDIS portrayal.
