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

## `light`

Point features derived from S-57 `LIGHTS` objects.

- `color`, `status`: **not** normalised. This layer predates the code-list rule below and still emits
  GDAL's JSON array text, such as `[ "1" ]`. Normalising it is a compatible follow-up.
- `characteristic`, `signalGroup`, `periodSeconds`, `heightMetres`, `nominalRangeNm`, `sectorStart`,
  `sectorEnd`, `orientation`, `heightDatum`, `category`
- `cell`, `usageBand`, `compilationScale`

## Attribute code lists

Several S-57 attributes are lists, and several are single-valued enumerations; the sections above say
which. GDAL renders a list as `(count:value,value)`. The pipeline reduces
each to a comma-separated list of S-57 codes, so a tile property is always a plain string: `"3"`,
`"3,1"`, or absent. A single-valued attribute passes through unchanged. `light` is the one exception,
noted above.

Where several layers share the property name `category`, the S-57 attribute behind it differs by
`kind`: `buoy` uses `CATLAM`, `CATCAM` or `CATSPM`; `danger` uses `CATWRK` or `CATOBS`; `cable` uses
`CATCBL` or `CATPIP`. A reader must branch on `kind` before interpreting a code.

## Label anchors

`land-label` and `water-label` hold one point per distinct name in a cell, placed on the feature by
`ST_PointOnSurface`, so a feature spanning several tiles is labelled once rather than once per tile.

A feature whose bounding box reaches both opposite edges of its cell continues clear across it, so
no point inside the cell is a meaningful centre for it. Those anchors are dropped. A coarser cell
that contains the feature outright still labels it. This is what keeps `Lake Superior` from claiming
a label in every cell it passes through.

The rule only catches a feature that spans a cell edge to edge. A mainland entering a cell as a
corner sliver still touches two edges that are not an opposite pair, so it keeps its anchor and is
labelled — `Wisconsin` in US4WI1QF is the worked example. That is deliberate: a corner sliver is
visible and placeable. Dropping it would need a second, area-based criterion.

- `name`: `OBJNAM`, always present
- `spanDegrees`: the larger of the anchor's bounding-box width and height in degrees, floored at 0.005
- `kind`: `land-label` distinguishes `land` from `settlement`; `water-label` has no kind
- `cell`, `usageBand`, `compilationScale`

`land-label` draws on `LNDARE`, `LNDRGN` and `BUAARE`; `water-label` draws on `SEAARE`.

## `buoy`

Point features from `BOYLAT`, `BOYCAR`, `BOYSAW`, `BOYISD` and `BOYSPP`.

- `name`: `OBJNAM` when named
- `kind`: `lateral`, `cardinal`, `safe-water`, `isolated-danger` or `special-purpose`
- `category`: code list from `CATLAM`, `CATCAM` or `CATSPM`; absent for safe-water and isolated-danger
- `shape`: `BOYSHP` code
- `color`, `colorPattern`: code lists from `COLOUR` and `COLPAT`
- `cell`, `usageBand`, `compilationScale`

## `danger`

Point features from `WRECKS`, `OBSTRN` and `UWTROC`. Area and line primitives contribute a single
point placed on the feature, so every danger carries one symbol.

- `name`: `OBJNAM` when named
- `kind`: `wreck`, `obstruction` or `rock`
- `category`: code list from `CATWRK` or `CATOBS`; absent for rocks
- `depth`: `VALSOU` in metres when sounded
- `waterLevel`: `WATLEV` code
- `soundingQuality`: code list from `QUASOU`
- `cell`, `usageBand`, `compilationScale`

## `harbour-facility`

Point features from `HRBFAC`. Area primitives contribute a point placed on the feature.

- `name`: `OBJNAM` when named
- `category`: code list from `CATHAF`
- `cell`, `usageBand`, `compilationScale`

## `anchorage`

Polygon features from `ACHARE`.

- `name`: `OBJNAM` when named
- `category`: code list from `CATACH`
- `cell`, `usageBand`, `compilationScale`

## `restricted-area`

Polygon features from `CBLARE`, `RESARE` and `PIPARE`, where a restriction applies to the water.

- `name`: `OBJNAM` when named
- `kind`: `cable-area`, `restricted` or `pipeline-area`
- `restriction`: code list from `RESTRN`. An area whose only restriction is code 16 is excluded from
  the layer: in NOAA's Great Lakes cells that is the 40 CFR 140 No-Discharge Zone, which covers
  essentially all Wisconsin and Michigan water. It is a standing regulation, not a local restriction,
  and charting it would lay one area over the whole chart. Code 16 never co-occurs with another
  restriction in this data, so excluding it cannot drop an anchoring rule.
- `information`: `INFORM`, the regulation NOAA cites, such as `40 CFR 140` or
  `Security zone, 33 CFR 165.910`. For a restriction whose code S-57 never published this is the only
  intelligible account of it, so a display should surface it.
- `category`: code list from `CATREA`, which S-57 gives to `RESARE` alone. Always absent on a
  `cable-area` or `pipeline-area`.
- `anchoring`: `prohibited` when `RESTRN` contains 1, `restricted` when it contains 2, otherwise absent.
  Derived in the pipeline so the webapp styles an anchoring restriction from one field rather than
  parsing a code list in a style expression. It can under-report: a cell expressing an anchoring rule
  through one of the codes GDAL does not define (16, 17, 22, 24) yields no `anchoring` value, and the
  area falls back to neutral styling with its raw codes shown. Absent means "not derived", not "safe
  to anchor".
- `cell`, `usageBand`, `compilationScale`

## `restricted-area-edge`

Line features: the outline of each `restricted-area`, with the segments that lie along the cell's own
coverage boundary removed. A restricted area is clipped to its cell, so each cell carries a cut edge
that is not a feature of the chart; two cells meeting across one area would otherwise draw a seam
through it. Each cell's outline stops at the boundary where the neighbouring cell's resumes, so the
area reads as the single polygon it is. An area that never reaches the cell edge passes through whole.

A display must draw restricted-area outlines from this layer, not from the `restricted-area` polygon.

An outline is drawn only for an area that carries a `restriction`. An area described by `category`
alone is a designation rather than a rule binding on a vessel — the Apostle Islands National
Lakeshore is `CATREA` 23 with no `RESTRN` — and its boundary is a long line easily misread as a
depth contour. Those areas are labelled and left unoutlined. The label carries the meaning; the
outline is reserved for a restriction that changes what a vessel may do.

- `name`, `kind`, `restriction`, `anchoring`: as on `restricted-area`. `restriction` is carried
  because the outline is drawn only where it is present.
- `cell`, `usageBand`, `compilationScale`

## `cable`

Line features from `CBLSUB` and submarine `PIPSOL` runs.

- `name`: `OBJNAM` when named
- `kind`: `cable` or `pipeline`
- `category`: code list from `CATCBL` or `CATPIP`
- `cell`, `usageBand`, `compilationScale`

## `shoreline-structure`

Point, line and polygon features from `SLCONS`, `PONTON` and `FLODOC`. Geometry primitives are kept
as they are: a pier is charted as an area in one cell and a line in another, and a display separates
them with a `geometry-type` filter rather than the pipeline forcing one shape.

- `name`: `OBJNAM` when named
- `kind`: `construction`, `pontoon` or `floating-dock`
- `category`: `CATSLC`, a single-valued enumeration. S-57 gives no category to `PONTON` or `FLODOC`,
  so it is absent on those. A reader must only interpret it when `kind` is `construction`.
- `condition`: `CONDTN`, single-valued. Code 2 is ruined, which the Apostle Islands dock ruins carry;
  the pipeline emits it for all three source classes, so a pontoon may be ruined too.
- `waterLevel`: code list from `WATLEV`. `PONTON` and `FLODOC` do not carry it.
- `cell`, `usageBand`, `compilationScale`

A display must not draw this layer uniformly. Around 40% of `SLCONS` is shoreline armouring —
rip rap (`CATSLC` 8), sea wall (10), revetment (9) — which is coastline detail rather than a
structure to tie to, and drawing it like a pier buries the piers. Every other category, including
the ones S-57 leaves ambiguous (groyne, training wall, fender, landing steps) and the uncategorised
features, draws as a structure: a shore work projecting into navigable water is better over-drawn
than hidden. A ruined structure must be distinguishable from a usable one without a tap, because
tying to a ruin is the failure this layer exists to prevent. `FLODOC` is a floating dry dock,
a shipyard structure, and must never be portrayed or described as a berth.

## `mooring`

Point, line and polygon features from `MORFAC`: the dolphins, bollards, pile moorings and mooring
buoys a vessel makes fast to.

- `name`: `OBJNAM` when named
- `category`: `CATMOR`, single-valued
- `condition`: `CONDTN`, single-valued
- `waterLevel`: code list from `WATLEV`
- there is no `kind`: `MORFAC` is the only source class, so there is nothing to disambiguate
- `cell`, `usageBand`, `compilationScale`

## `landmark`

Point and area features from `LNDMRK`: the towers, masts, chimneys and spires a mariner takes a
bearing on. The lighthouse structures are here, not in `light`.

- `name`: `OBJNAM` when named
- `category`: code list from `CATLMK`. 17 is a tower.
- `function`: code list from `FUNCTN`, so it may hold several codes. 33 is "light support" — the
  structure carrying a charted light. It is the only reliable test for one: a light support is not
  always `CATLMK` 17, and is charted as a chimney or a dome in some cells.
- `heightMetres`: `HEIGHT`, the height of the structure, when present. Most landmarks have none.
  S-57 measures it above ground, and `LNDMRK` carries no vertical datum to say otherwise.
- `conspicuous`: `CONVIS`, single-valued. 1 where the landmark is visually conspicuous.
- `cell`, `usageBand`, `compilationScale`

Two constraints a display must respect:

`landmark.heightMetres` is the height of the structure. `light.heightMetres` is the elevation of the
light's focal plane. They are different measurements of the same lighthouse and must never be
labelled alike or substituted for one another.

A light support is co-located with a `light` feature, because a lighthouse is charted as a tower
plus a light. The two must be drawn so that neither suppresses the other, and one lighthouse must
not read as two separate aids.

## S-57 code meanings

GDAL ships the S-57 attribute value tables as `s57attributes.csv` and `s57expectedinput.csv`.
They are authoritative where they have an entry but incomplete: `RESTRN` stops at 15, and NOAA
uses 16, 17, 22 and 24. A display must show the code itself when no meaning is known rather than
guess at one. Restriction wording is not a place to infer.

## Display rules

- Source depth values remain in metres. Unit conversion is a presentation concern.
- A feature must retain its source cell and scale metadata.
- The webapp should prefer the largest-scale suitable coverage and must indicate overscaling.
- Soundings should be filtered by zoom and density rather than rendered at all scales.
- Depth contours should carry their value along the line in the display unit. Foot and fathom
  curves are whole units: NOAA stores the 6 ft curve as 1.8 m, so a converted value is rounded
  to recover what the chart calls it. The zero curve is the low-water line and is not labelled.
- Landform labels should appear only in the zoom band where the landform is legible at screen size, using `spanDegrees`, so mainland labels do not persist at every scale.
- Sounding and light labels take collision priority over landform and water labels.
- Buoys and dangers are aids and hazards, not decoration: they take collision priority over every label.
- An anchoring restriction must be visible without opening a popup. It is carried by the area's
  outline and label, not by a fill wash: these areas are large enough to tint the chart beneath
  them, and a national lakeshore covers most of its cell.
- A restricted area is drawn above every cell, not within its own cell's stack. It belongs to
  whichever cell charted it, which is often coarser than the harbour cell in view, and a finer
  cell's opaque coverage would otherwise hide it while it still answered clicks.
- Depths stay in metres in the tiles. `danger.depth` converts for display like a sounding.
- Schema version 1 styling is intentionally simplified and must not be represented as IHO S-52/ECDIS portrayal.
