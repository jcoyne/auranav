import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectEntries } from "./inventory.js";
import { validateManifest } from "./manifest.js";
import { type Command, type CommandRunner, runCommand } from "./process.js";

const REQUIRED_LAYERS = [
  "COALNE", "DEPARE", "DEPCNT", "SOUNDG", "LIGHTS", "LNDARE", "LNDRGN", "BUAARE", "SEAARE",
  "BOYLAT", "BOYCAR", "BOYSPP", "BOYSAW", "BOYISD", "WRECKS", "OBSTRN", "UWTROC", "HRBFAC",
  "ACHARE", "CBLARE", "RESARE", "PIPARE", "CBLSUB", "PIPSOL",
] as const;
const INSPECTED_LAYERS = ["M_COVR", ...REQUIRED_LAYERS] as const;
const LAYER_NAMES = [
  "coverage", "coastline", "depth-area", "depth-contour", "sounding", "light", "land-area", "land-label",
  "water-label", "buoy", "danger", "harbour-facility", "anchorage", "restricted-area",
  "restricted-area-edge", "cable",
] as const;

/**
 * A landform label is anchored once per name, so a polygon split across tiles
 * cannot repeat its label. Point landforms have no extent of their own, so they
 * borrow this span and appear at the zoom band of a small island.
 */
const MINIMUM_LABEL_SPAN_DEGREES = 0.005;

/**
 * Coverage edges are stored to more decimal places than a feature boundary
 * shares exactly, so "touches the edge" is judged with a tolerance rather than
 * by equality. A millionth of a degree is about 10 cm.
 */
const EDGE_TOLERANCE_DEGREES = 0.000001;

type RequiredLayer = (typeof REQUIRED_LAYERS)[number];
type InspectedLayer = (typeof INSPECTED_LAYERS)[number];
type Bounds = readonly [number, number, number, number];

export interface ConvertCellOptions {
  readonly baseCell: string;
  readonly outputDirectory: string;
  readonly packageId: string;
  readonly packageName: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly userAgreement: string;
  readonly generatedAt?: string;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  readonly ogrinfo?: string;
  readonly ogr2ogr?: string;
}

export interface CellMetadata {
  readonly name: string;
  readonly edition: number;
  readonly updateNumber: number;
  readonly issueDate: string;
  readonly updateApplicationDate: string;
  readonly usageBand: number;
  readonly compilationScale: number;
  readonly verticalDatum: string;
  readonly soundingDatum: string;
}

export class CancelledCellError extends Error {
  override readonly name = "CancelledCellError";

  constructor(cellName: string) {
    super(`ENC cell ${cellName} is cancelled (edition 0)`);
  }
}

interface OgrLayerSummary {
  readonly name?: unknown;
  readonly featureCount?: unknown;
  readonly geometryFields?: readonly { readonly extent?: unknown }[];
  readonly features?: readonly { readonly properties?: unknown; readonly geometry?: unknown }[];
}

interface OgrInfoDocument {
  readonly driverShortName?: unknown;
  readonly layers?: readonly OgrLayerSummary[];
}

interface MetadataResult {
  readonly cell: CellMetadata;
  readonly bounds: Bounds;
  readonly layers: readonly RequiredLayer[];
}

interface ExtractSpec {
  /** Source layers, narrowed to those a cell actually contains before extraction. */
  readonly sources: readonly InspectedLayer[];
  readonly outputLayer: (typeof LAYER_NAMES)[number];
  readonly properties: readonly string[];
  readonly where?: string;
  /** SpatiaLite geometry functions are unavailable in the default OGRSQL dialect. */
  readonly dialect?: "OGRSQL" | "SQLITE";
  /** Set where a cell can legitimately hold the source layer but no feature that survives the filter. */
  readonly mayBeEmpty?: boolean;
  readonly buildSql?: (
    sources: readonly InspectedLayer[],
    constants: readonly string[],
    bounds: Bounds,
  ) => string;
}

/** How one source class of a multi-class output layer names and categorises itself. */
interface SourceVariant {
  readonly kind: string;
  /** The S-57 attribute holding the category code list, where the class defines one. */
  readonly category?: string;
}

const LABEL_KINDS: Readonly<Record<string, string>> = { LNDARE: "land", LNDRGN: "land", BUAARE: "settlement" };

const BUOY_VARIANTS: Readonly<Record<string, SourceVariant>> = {
  BOYLAT: { kind: "lateral", category: "CATLAM" },
  BOYCAR: { kind: "cardinal", category: "CATCAM" },
  BOYSPP: { kind: "special-purpose", category: "CATSPM" },
  BOYSAW: { kind: "safe-water" },
  BOYISD: { kind: "isolated-danger" },
};

const DANGER_VARIANTS: Readonly<Record<string, SourceVariant>> = {
  WRECKS: { kind: "wreck", category: "CATWRK" },
  OBSTRN: { kind: "obstruction", category: "CATOBS" },
  UWTROC: { kind: "rock" },
};

// S-57 gives CATREA to RESARE alone; CBLARE and PIPARE have no category attribute.
const RESTRICTED_AREA_VARIANTS: Readonly<Record<string, SourceVariant>> = {
  CBLARE: { kind: "cable-area" },
  RESARE: { kind: "restricted", category: "CATREA" },
  PIPARE: { kind: "pipeline-area" },
};

const CABLE_VARIANTS: Readonly<Record<string, SourceVariant>> = {
  CBLSUB: { kind: "cable", category: "CATCBL" },
  PIPSOL: { kind: "pipeline", category: "CATPIP" },
};

export const EXTRACTS: readonly ExtractSpec[] = [
  // CATCOV=2 describes areas where coverage is explicitly unavailable. Those
  // polygons are not part of the cell's positive coverage mask.
  { sources: ["M_COVR"], outputLayer: "coverage", properties: [], where: "CATCOV = 1" },
  { sources: ["COALNE"], outputLayer: "coastline", properties: [] },
  { sources: ["DEPARE"], outputLayer: "depth-area", properties: ["DRVAL1 AS minimumDepth", "DRVAL2 AS maximumDepth"] },
  { sources: ["DEPCNT"], outputLayer: "depth-contour", properties: ["VALDCO AS depth"] },
  { sources: ["SOUNDG"], outputLayer: "sounding", properties: ["DEPTH AS depth"] },
  // LNDARE also carries point and line primitives, which a fill cannot draw.
  {
    sources: ["LNDARE"],
    outputLayer: "land-area",
    properties: ["OBJNAM AS name"],
    where: "OGR_GEOMETRY = 'POLYGON'",
    mayBeEmpty: true,
  },
  {
    sources: ["LNDARE", "LNDRGN", "BUAARE"],
    outputLayer: "land-label",
    properties: [],
    dialect: "SQLITE",
    buildSql: landLabelSql,
    mayBeEmpty: true,
  },
  {
    sources: ["SEAARE"],
    outputLayer: "water-label",
    properties: [],
    dialect: "SQLITE",
    buildSql: waterLabelSql,
    mayBeEmpty: true,
  },
  {
    sources: ["LIGHTS"],
    outputLayer: "light",
    properties: [
      "COLOUR AS color",
      "LITCHR AS characteristic",
      "SIGGRP AS signalGroup",
      "SIGPER AS periodSeconds",
      "HEIGHT AS heightMetres",
      "VALNMR AS nominalRangeNm",
      "SECTR1 AS sectorStart",
      "SECTR2 AS sectorEnd",
      "ORIENT AS orientation",
      "VERDAT AS heightDatum",
      "CATLIT AS category",
      "STATUS AS status",
    ],
  },
  {
    sources: ["BOYLAT", "BOYCAR", "BOYSPP", "BOYSAW", "BOYISD"],
    outputLayer: "buoy",
    properties: [],
    dialect: "SQLITE",
    buildSql: buoySql,
    mayBeEmpty: true,
  },
  {
    sources: ["WRECKS", "OBSTRN", "UWTROC"],
    outputLayer: "danger",
    properties: [],
    dialect: "SQLITE",
    buildSql: dangerSql,
    mayBeEmpty: true,
  },
  {
    sources: ["HRBFAC"],
    outputLayer: "harbour-facility",
    properties: [],
    dialect: "SQLITE",
    buildSql: harbourFacilitySql,
    mayBeEmpty: true,
  },
  {
    sources: ["ACHARE"],
    outputLayer: "anchorage",
    properties: [],
    dialect: "SQLITE",
    buildSql: anchorageSql,
    mayBeEmpty: true,
  },
  {
    sources: ["CBLARE", "RESARE", "PIPARE"],
    outputLayer: "restricted-area",
    properties: [],
    dialect: "SQLITE",
    buildSql: restrictedAreaSql,
    mayBeEmpty: true,
  },
  {
    sources: ["CBLARE", "RESARE", "PIPARE"],
    outputLayer: "restricted-area-edge",
    properties: [],
    dialect: "SQLITE",
    buildSql: restrictedAreaEdgeSql,
    mayBeEmpty: true,
  },
  {
    sources: ["CBLSUB", "PIPSOL"],
    outputLayer: "cable",
    properties: [],
    dialect: "SQLITE",
    buildSql: cableSql,
    mayBeEmpty: true,
  },
];

export function metadataCommand(baseCell: string, ogrinfo = "ogrinfo"): Command {
  return {
    executable: ogrinfo,
    args: ["-ro", "-json", "-features", "-oo", "UPDATES=APPLY", path.resolve(baseCell), "DSID"],
  };
}

export function datasetSummaryCommand(baseCell: string, ogrinfo = "ogrinfo"): Command {
  return {
    executable: ogrinfo,
    args: [
      "-ro",
      "-json",
      "-summary",
      "-oo",
      "UPDATES=APPLY",
      "-oo",
      "SPLIT_MULTIPOINT=ON",
      "-oo",
      "ADD_SOUNDG_DEPTH=ON",
      path.resolve(baseCell),
    ],
  };
}

export function coverageCommand(baseCell: string, ogrinfo = "ogrinfo"): Command {
  return {
    executable: ogrinfo,
    args: ["-ro", "-json", "-features", "-oo", "UPDATES=APPLY", "-where", "CATCOV = 1", path.resolve(baseCell), "M_COVR"],
  };
}

export function parseLayerSummaries(summaryJson: string): ReadonlyMap<InspectedLayer, string> {
  const document = parseOgrDocument(summaryJson, "dataset summary");
  if (document.driverShortName !== "S57") throw new Error("Input is not reported as an S-57 dataset");
  const summaries = new Map<InspectedLayer, string>();
  for (const name of INSPECTED_LAYERS) {
    const layer = document.layers?.find((candidate) => candidate.name === name);
    if (layer !== undefined) summaries.set(name, JSON.stringify({ driverShortName: "S57", layers: [layer] }));
  }
  return summaries;
}

export function extractionCommand(
  baseCell: string,
  output: string,
  spec: ExtractSpec,
  cell: CellMetadata,
  bounds: Bounds,
  create: boolean,
  ogr2ogr = "ogr2ogr",
): Command {
  const constants = [
    `'${cell.name}' AS cell`,
    `${cell.usageBand} AS usageBand`,
    `${cell.compilationScale} AS compilationScale`,
  ];
  const sql = spec.buildSql === undefined
    ? projectionSql(spec, constants)
    : spec.buildSql(spec.sources, constants, bounds);
  return {
    executable: ogr2ogr,
    args: [
      "-f",
      "GPKG",
      create ? "-overwrite" : "-update",
      "-t_srs",
      "EPSG:4326",
      "-nln",
      spec.outputLayer,
      "-oo",
      "UPDATES=APPLY",
      "-oo",
      "SPLIT_MULTIPOINT=ON",
      "-oo",
      "ADD_SOUNDG_DEPTH=ON",
      "-dialect",
      spec.dialect ?? "OGRSQL",
      "-sql",
      sql,
      path.resolve(output),
      path.resolve(baseCell),
    ],
  };
}

function projectionSql(spec: ExtractSpec, constants: readonly string[]): string {
  const source = spec.sources[0];
  if (source === undefined || spec.sources.length !== 1) {
    throw new Error(`Extract ${spec.outputLayer} needs exactly one source layer without a SQL builder`);
  }
  const columns = [...spec.properties, ...constants].join(", ");
  return `SELECT ${columns} FROM ${source}${spec.where === undefined ? "" : ` WHERE ${spec.where}`}`;
}

/**
 * GDAL renders an S-57 attribute list as the text `(count:v1,v2)`. Reducing it
 * to `v1,v2` gives the webapp one plain string to match on whatever the
 * attribute's cardinality: a scalar has no `(count:` prefix, so `instr` returns
 * 0 and the value passes through unchanged, and an absent attribute stays NULL.
 */
function codeListExpression(attribute: string): string {
  const text = `CAST(${attribute} AS character(64))`;
  return `replace(substr(${text}, instr(${text}, ':') + 1), ')', '')`;
}

function codeList(attribute: string, alias: string): string {
  return `${codeListExpression(attribute)} AS ${alias}`;
}

/**
 * Builds one branch per source class. OGRSQL cannot express UNION ALL, so every
 * layer drawn from more than one S-57 class runs in the SQLite dialect, and
 * each branch must project the same column names in the same order.
 */
function unionSql(
  outputLayer: string,
  sources: readonly InspectedLayer[],
  columns: (source: InspectedLayer) => readonly string[],
  where?: string,
): string {
  if (sources.length === 0) throw new Error(`Extract ${outputLayer} needs at least one source layer`);
  return sources
    .map((source) => `SELECT ${columns(source).join(", ")} FROM ${source}${where === undefined ? "" : ` WHERE ${where}`}`)
    .join(" UNION ALL ");
}

function variantFor(
  variants: Readonly<Record<string, SourceVariant>>,
  source: InspectedLayer,
  outputLayer: string,
): SourceVariant {
  const variant = variants[source];
  if (variant === undefined) throw new Error(`Extract ${outputLayer} has no variant for source layer ${source}`);
  return variant;
}

/** A class without a category attribute still has to project the column the union expects. */
function categoryColumn(variant: SourceVariant): string {
  return variant.category === undefined ? "NULL AS category" : codeList(variant.category, "category");
}

/**
 * A feature whose bounding box reaches both opposite edges of the cell runs
 * past it, so no point inside the cell is a meaningful centre for it and its
 * anchor is dropped. A coarser cell that contains the feature outright still
 * labels it.
 */
function unclippedCondition(bounds: Bounds): string {
  const [west, south, east, north] = bounds;
  const spansWidth = `ST_MinX(shape) <= ${west} + ${EDGE_TOLERANCE_DEGREES}`
    + ` AND ST_MaxX(shape) >= ${east} - ${EDGE_TOLERANCE_DEGREES}`;
  const spansHeight = `ST_MinY(shape) <= ${south} + ${EDGE_TOLERANCE_DEGREES}`
    + ` AND ST_MaxY(shape) >= ${north} - ${EDGE_TOLERANCE_DEGREES}`;
  return `NOT ((${spansWidth}) OR (${spansHeight}))`;
}

/**
 * Anchors one label per named feature at a point guaranteed to lie on it, so
 * MapLibre never repeats or misplaces a label for a polygon that spans several
 * tiles. `spanDegrees` lets the webapp pick a legible zoom band. Where a name
 * is carried by more than one kind of source, `MIN` settles it, so a name that
 * is both a landform and a built-up area is labelled as a landform.
 */
function labelAnchorSql(
  outputLayer: string,
  sources: readonly InspectedLayer[],
  constants: readonly string[],
  bounds: Bounds,
  kinds?: Readonly<Record<string, string>>,
): string {
  const parts = unionSql(
    outputLayer,
    sources,
    (source) => [
      "OBJNAM AS name",
      ...(kinds === undefined ? [] : [`'${kindFor(kinds, source, outputLayer)}' AS kind`]),
      "geometry AS part",
    ],
    "OBJNAM IS NOT NULL",
  );
  const grouped = [
    "name",
    ...(kinds === undefined ? [] : ["MIN(kind) AS kind"]),
    "ST_Union(part) AS shape",
  ].join(", ");
  const columns = [
    "name",
    ...(kinds === undefined ? [] : ["kind"]),
    `MAX(ST_MaxX(shape) - ST_MinX(shape), ST_MaxY(shape) - ST_MinY(shape), ${MINIMUM_LABEL_SPAN_DEGREES}) AS spanDegrees`,
    "ST_PointOnSurface(shape) AS geometry",
    ...constants,
  ].join(", ");
  return `SELECT ${columns} FROM (SELECT ${grouped} FROM (${parts}) GROUP BY name)`
    + ` WHERE ${unclippedCondition(bounds)}`;
}

function kindFor(kinds: Readonly<Record<string, string>>, source: InspectedLayer, outputLayer: string): string {
  const kind = kinds[source];
  if (kind === undefined) throw new Error(`Extract ${outputLayer} has no kind for source layer ${source}`);
  return kind;
}

function landLabelSql(sources: readonly InspectedLayer[], constants: readonly string[], bounds: Bounds): string {
  return labelAnchorSql("land-label", sources, constants, bounds, LABEL_KINDS);
}

function waterLabelSql(sources: readonly InspectedLayer[], constants: readonly string[], bounds: Bounds): string {
  return labelAnchorSql("water-label", sources, constants, bounds);
}

function buoySql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  return unionSql("buoy", sources, (source) => {
    const variant = variantFor(BUOY_VARIANTS, source, "buoy");
    return [
      "OBJNAM AS name",
      `'${variant.kind}' AS kind`,
      categoryColumn(variant),
      codeList("BOYSHP", "shape"),
      codeList("COLOUR", "color"),
      codeList("COLPAT", "colorPattern"),
      ...constants,
      "geometry",
    ];
  });
}

/**
 * WRECKS, OBSTRN and UWTROC carry point, line and area primitives. Reducing
 * each to a point on the feature gives every danger exactly one symbol; names
 * are not grouped, because two dangers sharing a name are still two dangers.
 */
function dangerSql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  return unionSql("danger", sources, (source) => {
    const variant = variantFor(DANGER_VARIANTS, source, "danger");
    return [
      "OBJNAM AS name",
      `'${variant.kind}' AS kind`,
      categoryColumn(variant),
      "VALSOU AS depth",
      codeList("WATLEV", "waterLevel"),
      codeList("QUASOU", "soundingQuality"),
      ...constants,
      "ST_PointOnSurface(geometry) AS geometry",
    ];
  });
}

function harbourFacilitySql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  return unionSql("harbour-facility", sources, () => [
    "OBJNAM AS name",
    codeList("CATHAF", "category"),
    ...constants,
    "ST_PointOnSurface(geometry) AS geometry",
  ]);
}

function anchorageSql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  return unionSql("anchorage", sources, () => [
    "OBJNAM AS name",
    codeList("CATACH", "category"),
    ...constants,
    "geometry",
  ]);
}

function restrictedAreaSql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  return unionSql("restricted-area", sources, (source) => {
    const variant = variantFor(RESTRICTED_AREA_VARIANTS, source, "restricted-area");
    return [
      "OBJNAM AS name",
      `'${variant.kind}' AS kind`,
      codeList("RESTRN", "restriction"),
      categoryColumn(variant),
      anchoringColumn(),
      ...constants,
      "geometry",
    ];
  });
}

/**
 * A restricted area is clipped to its cell, so each cell carries its own cut
 * edge. Two cells meeting across one area then draw a seam along their shared
 * boundary that is not a feature of the chart. Subtracting the cell's own
 * coverage boundary removes exactly those cut edges: each cell's outline stops
 * at the boundary, where the neighbouring cell's outline resumes, and the area
 * reads as the single polygon it is. An area that never reaches the cell edge
 * passes through whole.
 */
function restrictedAreaEdgeSql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  const areas = unionSql("restricted-area-edge", sources, (source) => {
    const variant = variantFor(RESTRICTED_AREA_VARIANTS, source, "restricted-area-edge");
    return ["OBJNAM AS name", `'${variant.kind}' AS kind`, anchoringColumn(), "geometry"];
  });
  const trimmed = `ST_Difference(ST_Boundary(area.geometry), `
    + `ST_Buffer(ST_Boundary(cover.extent), ${EDGE_TOLERANCE_DEGREES}))`;
  const columns = ["name", "kind", "anchoring", ...constants, `${trimmed} AS geometry`];
  return `SELECT * FROM (SELECT ${columns.join(", ")} FROM (${areas}) area, `
    + `(SELECT ST_Union(geometry) AS extent FROM M_COVR WHERE CATCOV = 1) cover) `
    + `WHERE geometry IS NOT NULL`;
}

/**
 * RESTRN code 1 prohibits anchoring and code 2 restricts it. Deriving the
 * answer here saves the webapp from parsing a code list in a style expression.
 * The list is wrapped in commas so that code 1 cannot match inside 10, 16 or 17.
 */
function anchoringColumn(): string {
  const codes = `',' || ${codeListExpression("RESTRN")} || ','`;
  return `CASE WHEN instr(${codes}, ',1,') > 0 THEN 'prohibited'`
    + ` WHEN instr(${codes}, ',2,') > 0 THEN 'restricted' END AS anchoring`;
}

function cableSql(sources: readonly InspectedLayer[], constants: readonly string[]): string {
  return unionSql("cable", sources, (source) => {
    const variant = variantFor(CABLE_VARIANTS, source, "cable");
    return [
      "OBJNAM AS name",
      `'${variant.kind}' AS kind`,
      categoryColumn(variant),
      ...constants,
      "geometry",
    ];
  });
}

/** Fails early and by name when GDAL lacks the SpatiaLite functions labels need. */
export function spatialiteProbeCommand(baseCell: string, ogrinfo = "ogrinfo"): Command {
  return {
    executable: ogrinfo,
    args: [
      "-ro", "-q", "-dialect", "SQLITE", "-sql",
      "SELECT ST_PointOnSurface(ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))')) AS geometry",
      path.resolve(baseCell),
    ],
  };
}

export function tileCommand(
  output: string,
  stagingDatabase: string,
  minZoom = 0,
  maxZoom = 16,
  ogr2ogr = "ogr2ogr",
): Command {
  return {
    executable: ogr2ogr,
    args: ["-f", "PMTiles", "-overwrite", "-dsco", `MINZOOM=${minZoom}`, "-dsco", `MAXZOOM=${maxZoom}`, path.resolve(output), path.resolve(stagingDatabase)],
  };
}

export function packageSummaryCommand(pmtiles: string, ogrinfo = "ogrinfo"): Command {
  return { executable: ogrinfo, args: ["-ro", "-json", "-summary", path.resolve(pmtiles)] };
}

export function stagingSummaryCommand(stagingDatabase: string, ogrinfo = "ogrinfo"): Command {
  return { executable: ogrinfo, args: ["-ro", "-json", "-summary", path.resolve(stagingDatabase)] };
}

/**
 * A cell can hold a source layer whose features are all filtered out: land
 * areas with no polygon, or land regions with no name. Advertising a layer the
 * tiles do not contain would make the webapp add a layer that never draws, so
 * such a layer is dropped. Any other empty extract is a conversion fault.
 */
export function parseProducedLayers(
  summaryJson: string,
  attempted: readonly { readonly name: (typeof LAYER_NAMES)[number]; readonly mayBeEmpty: boolean }[],
): (typeof LAYER_NAMES)[number][] {
  const document = parseOgrDocument(summaryJson, "staging summary");
  const produced: (typeof LAYER_NAMES)[number][] = [];
  for (const { name, mayBeEmpty } of attempted) {
    const layer = document.layers?.find((candidate) => candidate.name === name);
    const featureCount = Number.isInteger(layer?.featureCount) ? Number(layer?.featureCount) : 0;
    if (featureCount >= 1) produced.push(name);
    else if (!mayBeEmpty) throw new Error(`Extracted layer ${name} contains no features`);
  }
  return produced;
}

export function parseMetadata(metadataJson: string, summaries: ReadonlyMap<InspectedLayer, string>): MetadataResult {
  const metadataDocument = parseOgrDocument(metadataJson, "DSID metadata");
  if (metadataDocument.driverShortName !== "S57") throw new Error("Input is not reported as an S-57 dataset");
  const dsidLayer = metadataDocument.layers?.find((layer) => layer.name === "DSID");
  const properties = dsidLayer?.features?.[0]?.properties;
  if (!isRecord(properties)) throw new Error("Required S-57 DSID/DSPM metadata is absent");

  const datasetName = requireString(properties, "DSID_DSNM");
  const cellName = datasetName.replace(/\.000$/i, "").toUpperCase();
  if (!/^US[1-6][A-Z0-9]{5}$/.test(cellName)) throw new Error(`Invalid NOAA ENC cell name in DSID: ${datasetName}`);
  const depthUnit = requireInteger(properties, "DSPM_DUNI");
  if (depthUnit !== 1) throw new Error(`Unsupported S-57 depth unit code ${depthUnit}; schema v1 requires metres`);

  const edition = requireNonnegativeIntegerString(properties, "DSID_EDTN");
  if (edition === 0) throw new CancelledCellError(cellName);
  const cell: CellMetadata = {
    name: cellName,
    edition,
    updateNumber: requireNonnegativeIntegerString(properties, "DSID_UPDN"),
    issueDate: parseS57Date(requireString(properties, "DSID_ISDT"), "DSID_ISDT"),
    updateApplicationDate: parseS57Date(requireString(properties, "DSID_UADT"), "DSID_UADT"),
    usageBand: Number(cellName[2]),
    compilationScale: requirePositiveInteger(properties, "DSPM_CSCL"),
    verticalDatum: datumName(requireInteger(properties, "DSPM_VDAT")),
    soundingDatum: datumName(requireInteger(properties, "DSPM_SDAT")),
  };

  const coverageSummary = summaries.get("M_COVR");
  if (coverageSummary === undefined) throw new Error("Required M_COVR coverage summary is absent");
  const coverageDocument = parseOgrDocument(coverageSummary, "M_COVR summary");
  const coverageLayer = coverageDocument.layers?.find((candidate) => candidate.name === "M_COVR");
  if (coverageLayer === undefined || !Number.isInteger(coverageLayer.featureCount) || Number(coverageLayer.featureCount) < 1) {
    throw new Error("Required S-57 layer M_COVR contains no coverage features");
  }
  const bounds = coverageLayer.features === undefined
    ? parseBounds(coverageLayer.geometryFields?.[0]?.extent, "M_COVR")
    : boundsFromFeatures(coverageLayer.features, "M_COVR");
  const layers: RequiredLayer[] = [];
  for (const requiredLayer of REQUIRED_LAYERS) {
    const rawSummary = summaries.get(requiredLayer);
    if (rawSummary === undefined) continue;
    const document = parseOgrDocument(rawSummary, `${requiredLayer} summary`);
    const layer = document.layers?.find((candidate) => candidate.name === requiredLayer);
    if (layer === undefined) throw new Error(`Required S-57 layer ${requiredLayer} is absent`);
    if (!Number.isInteger(layer.featureCount) || Number(layer.featureCount) < 1) {
      throw new Error(`Required S-57 layer ${requiredLayer} contains no features`);
    }
    parseBounds(layer.geometryFields?.[0]?.extent, requiredLayer);
    layers.push(requiredLayer);
  }
  if (layers.length === 0) throw new Error("S-57 cell contains none of the supported chart layers");
  if (layers.includes("LIGHTS")) {
    const heightUnit = requireInteger(properties, "DSPM_HUNI");
    if (heightUnit !== 1) {
      throw new Error(`Unsupported S-57 height unit code ${heightUnit}; light heightMetres requires metres`);
    }
  }
  return { cell, bounds, layers };
}

export async function convertCell(options: ConvertCellOptions, runner: CommandRunner = runCommand): Promise<string> {
  validateOptions(options);
  const baseCell = path.resolve(options.baseCell);
  const highestUpdate = await validateUpdateChain(baseCell);
  await requireNonemptyFile(options.userAgreement, "user agreement");

  const metadataResult = await runner(metadataCommand(baseCell, options.ogrinfo));
  const summaryResult = await runner(datasetSummaryCommand(baseCell, options.ogrinfo));
  const coverageResult = await runner(coverageCommand(baseCell, options.ogrinfo));
  const summaries = new Map(parseLayerSummaries(summaryResult.stdout));
  summaries.set("M_COVR", coverageResult.stdout);
  const { cell, bounds, layers } = parseMetadata(metadataResult.stdout, summaries);
  const expectedName = path.basename(baseCell, path.extname(baseCell)).toUpperCase();
  if (cell.name !== expectedName) throw new Error(`DSID cell ${cell.name} does not match input filename ${expectedName}`);
  if (cell.updateNumber !== highestUpdate) {
    throw new Error(`GDAL applied update ${cell.updateNumber}, but highest sequential update file is ${highestUpdate}`);
  }

  const outputDirectory = path.resolve(options.outputDirectory);
  const parent = path.dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  try {
    await lstat(outputDirectory);
    throw new Error(`Output directory already exists: ${outputDirectory}`);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const temporary = `${outputDirectory}.tmp-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });

  try {
    const stagingDatabase = path.join(temporary, "layers.gpkg");
    const extracts = EXTRACTS.flatMap((extract) => {
      const present = extract.sources.filter((source) => source === "M_COVR" || layers.includes(source));
      return present.length === 0 ? [] : [{ ...extract, sources: present }];
    });
    if (extracts.some((extract) => extract.dialect === "SQLITE")) await requireSpatialite(baseCell, options, runner);
    for (const [index, extract] of extracts.entries()) {
      await runner(extractionCommand(baseCell, stagingDatabase, extract, cell, bounds, index === 0, options.ogr2ogr));
    }
    const stagingSummary = await runner(stagingSummaryCommand(stagingDatabase, options.ogrinfo));
    const producedLayers = parseProducedLayers(
      stagingSummary.stdout,
      extracts.map((extract) => ({ name: extract.outputLayer, mayBeEmpty: extract.mayBeEmpty === true })),
    );

    const tileFilename = `${options.packageId}.pmtiles`;
    const tilePath = path.join(temporary, tileFilename);
    await runner(tileCommand(tilePath, stagingDatabase, options.minZoom, options.maxZoom, options.ogr2ogr));
    await requireNonemptyFile(tilePath, "PMTiles output");
    const packageSummary = await runner(packageSummaryCommand(tilePath, options.ogrinfo));
    validatePackageSummary(packageSummary.stdout, producedLayers);

    const agreementFilename = "USER_AGREEMENT.txt";
    await copyFile(path.resolve(options.userAgreement), path.join(temporary, agreementFilename));
    const manifest = createManifest(options, cell, bounds, tileFilename, agreementFilename, producedLayers);
    const temporaryManifest = path.join(temporary, "manifest.json");
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const validation = await validateManifest(temporaryManifest);
    if (!validation.valid) throw new Error(`Generated manifest does not conform to schema v1: ${JSON.stringify(validation.errors)}`);
    await rm(stagingDatabase);
    await rename(temporary, outputDirectory);
    return path.join(outputDirectory, "manifest.json");
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function requireSpatialite(
  baseCell: string,
  options: ConvertCellOptions,
  runner: CommandRunner,
): Promise<void> {
  try {
    await runner(spatialiteProbeCommand(baseCell, options.ogrinfo));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `GDAL cannot evaluate the SpatiaLite geometry functions that landform labels require: ${detail}`,
    );
  }
}

async function validateUpdateChain(baseCell: string): Promise<number> {
  const stat = await lstat(baseCell);
  if (!stat.isFile() || path.extname(baseCell) !== ".000") throw new Error("Base cell must be an extracted .000 file");
  const expectedName = path.basename(baseCell, ".000").toUpperCase();
  if (!/^US[1-6][A-Z0-9]{5}$/.test(expectedName)) throw new Error(`Invalid NOAA ENC base-cell filename: ${path.basename(baseCell)}`);
  const entries = await readdir(path.dirname(baseCell));
  const result = inspectEntries(entries);
  const relevantIssues = result.issues.filter((issue) => issue.cell === expectedName);
  const cell = result.cells.find((candidate) => candidate.name === expectedName);
  if (cell === undefined || cell.base === null) throw new Error(`No base cell found for ${expectedName}`);
  if (relevantIssues.length > 0) throw new Error(relevantIssues.map((issue) => issue.message).join("; "));
  return cell.updateNumbers.at(-1) ?? 0;
}

function createManifest(
  options: ConvertCellOptions,
  cell: CellMetadata,
  bounds: Bounds,
  tileFilename: string,
  agreementFilename: string,
  layers: readonly (typeof LAYER_NAMES)[number][],
): object {
  return {
    schemaVersion: 1,
    packageId: options.packageId,
    name: options.packageName,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      publisher: "NOAA Office of Coast Survey",
      product: "NOAA ENC",
      downloadUrl: options.sourceUrl,
      retrievedAt: options.retrievedAt,
      userAgreementPath: `./${agreementFilename}`,
    },
    bounds,
    depth: { storedUnit: "metre", displayUnit: "foot", verticalDatums: [cell.verticalDatum] },
    tileSets: [
      {
        id: `${cell.name.toLowerCase()}-chart`,
        cellName: cell.name,
        format: "pmtiles",
        url: `./${tileFilename}`,
        minZoom: options.minZoom ?? 0,
        maxZoom: options.maxZoom ?? 16,
        layers,
      },
    ],
    cells: [
      {
        name: cell.name,
        edition: cell.edition,
        updateNumber: cell.updateNumber,
        issueDate: cell.issueDate,
        updateApplicationDate: cell.updateApplicationDate,
        usageBand: cell.usageBand,
        compilationScale: cell.compilationScale,
        verticalDatum: `${cell.verticalDatum}; sounding datum: ${cell.soundingDatum}`,
        bounds,
      },
    ],
  };
}

function validateOptions(options: ConvertCellOptions): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.packageId)) throw new Error("package ID must be lowercase kebab-case");
  if (options.packageName.trim() === "") throw new Error("package name must not be empty");
  parseDateTime(options.retrievedAt, "retrieved-at");
  if (options.generatedAt !== undefined) parseDateTime(options.generatedAt, "generated-at");
  try {
    new URL(options.sourceUrl);
  } catch {
    throw new Error("source URL must be an absolute URL");
  }
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxZoom ?? 16;
  if (!Number.isInteger(minZoom) || minZoom < 0 || minZoom > 22) throw new Error("min zoom must be an integer from 0 through 22");
  if (!Number.isInteger(maxZoom) || maxZoom < minZoom || maxZoom > 22) throw new Error("max zoom must be an integer from min zoom through 22");
}

async function requireNonemptyFile(filename: string, label: string): Promise<void> {
  const stat = await lstat(path.resolve(filename));
  if (!stat.isFile() || stat.size === 0) throw new Error(`${label} must be a nonempty file: ${filename}`);
}

function parseOgrDocument(text: string, label: string): OgrInfoDocument {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) throw new Error("not an object");
    return value as OgrInfoDocument;
  } catch (error: unknown) {
    throw new Error(`Unable to parse ogrinfo ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseBounds(value: unknown, layer: string): Bounds {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
    throw new Error(`Required S-57 layer ${layer} has no valid extent`);
  }
  const [west, south, east, north] = value as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
    throw new Error(`Required S-57 layer ${layer} has invalid geographic bounds`);
  }
  return [west, south, east, north];
}

function boundsFromFeatures(features: readonly { readonly geometry?: unknown }[], layer: string): Bounds {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  const visit = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) throw new Error(`Required S-57 layer ${layer} has invalid geometry`);
    if (
      coordinates.length >= 2
      && typeof coordinates[0] === "number"
      && Number.isFinite(coordinates[0])
      && typeof coordinates[1] === "number"
      && Number.isFinite(coordinates[1])
    ) {
      west = Math.min(west, coordinates[0]);
      south = Math.min(south, coordinates[1]);
      east = Math.max(east, coordinates[0]);
      north = Math.max(north, coordinates[1]);
      return;
    }
    for (const child of coordinates) visit(child);
  };

  for (const feature of features) {
    if (!isRecord(feature.geometry) || !("coordinates" in feature.geometry)) {
      throw new Error(`Required S-57 layer ${layer} has invalid geometry`);
    }
    visit(feature.geometry.coordinates);
  }
  return parseBounds([west, south, east, north], layer);
}

function validatePackageSummary(text: string, expectedLayers: readonly (typeof LAYER_NAMES)[number][]): void {
  const document = parseOgrDocument(text, "PMTiles summary");
  if (document.driverShortName !== "PMTiles") throw new Error("Generated output is not reported as PMTiles");
  for (const layerName of expectedLayers) {
    const layer = document.layers?.find((candidate) => candidate.name === layerName);
    if (layer === undefined || !Number.isInteger(layer.featureCount) || Number(layer.featureCount) < 1) {
      throw new Error(`Generated PMTiles layer ${layerName} is absent or empty`);
    }
  }
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Required S-57 metadata ${field} is absent`);
  return value;
}

function requireInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (!Number.isInteger(value)) throw new Error(`Required S-57 metadata ${field} is absent or invalid`);
  return Number(value);
}

function requirePositiveInteger(record: Record<string, unknown>, field: string): number {
  const value = requireInteger(record, field);
  if (value < 1) throw new Error(`Required S-57 metadata ${field} must be positive`);
  return value;
}

function requireNonnegativeIntegerString(record: Record<string, unknown>, field: string): number {
  const value = Number(requireString(record, field));
  if (!Number.isInteger(value) || value < 0) throw new Error(`Required S-57 metadata ${field} must be a nonnegative integer`);
  return value;
}

function parseS57Date(value: string, field: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error(`Required S-57 metadata ${field} is not YYYYMMDD`);
  const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  if (new Date(`${formatted}T00:00:00Z`).toISOString().slice(0, 10) !== formatted) throw new Error(`Required S-57 metadata ${field} is not a valid date`);
  return formatted;
}

function parseDateTime(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value)) || !value.includes("T")) throw new Error(`${label} must be an ISO 8601 date-time`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function datumName(code: number): string {
  const names: Readonly<Record<number, string>> = {
    1: "mean low water springs", 2: "mean lower low water springs", 3: "mean sea level", 4: "lowest low water",
    5: "mean low water", 6: "lowest low water springs", 7: "approximate mean low water springs", 8: "Indian spring low water",
    9: "low water springs", 10: "approximate lowest astronomical tide", 11: "nearly lowest low water", 12: "mean lower low water",
    13: "low water", 14: "approximate mean low water", 15: "approximate mean lower low water", 16: "mean high water",
    17: "mean high water springs", 18: "high water", 19: "approximate mean sea level", 20: "high water springs",
    21: "mean higher high water", 22: "equinoctial spring low water", 23: "lowest astronomical tide", 24: "local datum",
    25: "International Great Lakes Datum 1985", 26: "mean water level", 27: "lower low water large tide", 28: "higher high water large tide",
    29: "nearly highest high water", 30: "highest astronomical tide",
  };
  return names[code] ?? `S-57 datum code ${code}`;
}
