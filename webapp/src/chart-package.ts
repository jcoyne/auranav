export const CHART_LAYERS = [
  "coastline", "depth-area", "depth-contour", "sounding", "light", "land-area", "land-label",
  "water-label", "buoy", "danger", "harbour-facility", "anchorage", "restricted-area", "restricted-area-edge", "cable",
] as const;
export const TILE_LAYERS = ["coverage", ...CHART_LAYERS] as const;

export type ChartLayer = (typeof CHART_LAYERS)[number];
export type TileLayer = (typeof TILE_LAYERS)[number];
export type DepthUnit = "metre" | "foot" | "fathom";

export type ChartTileSet = {
  id: string;
  cellName: string;
  format: "pmtiles" | "mvt";
  url: string;
  minZoom: number;
  maxZoom: number;
  layers: TileLayer[];
};

export type ChartCell = {
  name: string;
  edition: number;
  updateNumber: number;
  issueDate: string;
  updateApplicationDate: string;
  usageBand: number;
  compilationScale: number;
  verticalDatum?: string;
  bounds: Bounds;
};

export type Bounds = [number, number, number, number];

export type ChartPackageManifest = {
  schemaVersion: 1;
  packageId: string;
  name: string;
  generatedAt: string;
  source: {
    publisher: string;
    product: string;
    downloadUrl: string;
    retrievedAt: string;
    userAgreementPath: string;
  };
  bounds: Bounds;
  depth: {
    storedUnit: "metre";
    displayUnit: DepthUnit;
    verticalDatums: string[];
  };
  tileSets: ChartTileSet[];
  cells: ChartCell[];
};

export class ManifestError extends Error {
  override readonly name = "ManifestError";
}

export function parseChartPackageManifest(value: unknown): ChartPackageManifest {
  const manifest = record(value, "manifest");
  if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1");

  const source = record(manifest.source, "source");
  const depth = record(manifest.depth, "depth");
  const cells = array(manifest.cells, "cells").map(parseCell);
  if (cells.length === 0) fail("cells must not be empty");
  const tileSets = array(manifest.tileSets, "tileSets")
    .map((tileSet, index) => parseTileSet(tileSet, index, cells));
  if (tileSets.length === 0) fail("tileSets must not be empty");

  const storedUnit = string(depth.storedUnit, "depth.storedUnit");
  if (storedUnit !== "metre") fail("depth.storedUnit must be metre");
  const displayUnit = string(depth.displayUnit, "depth.displayUnit");
  if (!isDepthUnit(displayUnit)) fail("depth.displayUnit is unsupported");
  const verticalDatums = array(depth.verticalDatums, "depth.verticalDatums")
    .map((datum, index) => nonEmptyString(datum, `depth.verticalDatums[${index}]`));
  if (verticalDatums.length === 0) fail("depth.verticalDatums must not be empty");

  const publisher = nonEmptyString(source.publisher, "source.publisher");
  const product = nonEmptyString(source.product, "source.product");
  if (publisher !== "NOAA Office of Coast Survey") fail("source.publisher is unsupported");
  if (product !== "NOAA ENC") fail("source.product is unsupported");

  return {
    schemaVersion: 1,
    packageId: nonEmptyString(manifest.packageId, "packageId"),
    name: nonEmptyString(manifest.name, "name"),
    generatedAt: dateTime(manifest.generatedAt, "generatedAt"),
    source: {
      publisher,
      product,
      downloadUrl: nonEmptyString(source.downloadUrl, "source.downloadUrl"),
      retrievedAt: dateTime(source.retrievedAt, "source.retrievedAt"),
      userAgreementPath: nonEmptyString(source.userAgreementPath, "source.userAgreementPath"),
    },
    bounds: bounds(manifest.bounds, "bounds"),
    depth: { storedUnit: "metre", displayUnit, verticalDatums },
    tileSets,
    cells,
  };
}

function parseTileSet(value: unknown, index: number, cells: readonly ChartCell[]): ChartTileSet {
  const tileSet = record(value, `tileSets[${index}]`);
  const format = string(tileSet.format, `tileSets[${index}].format`);
  if (format !== "pmtiles" && format !== "mvt") fail(`tileSets[${index}].format is unsupported`);
  const minZoom = integer(tileSet.minZoom, `tileSets[${index}].minZoom`, 0, 24);
  const maxZoom = integer(tileSet.maxZoom, `tileSets[${index}].maxZoom`, 0, 24);
  if (minZoom > maxZoom) fail(`tileSets[${index}].minZoom must not exceed maxZoom`);
  const declaredLayers = array(tileSet.layers, `tileSets[${index}].layers`).map((layer, layerIndex) => {
    if (typeof layer !== "string") fail(`tileSets[${index}].layers[${layerIndex}] must be a string`);
    return layer;
  });
  if (declaredLayers.length === 0) fail(`tileSets[${index}].layers must not be empty`);
  // Schema version 1 may gain source layers compatibly. An older build must
  // skip what it cannot draw rather than reject the whole package.
  const layers = declaredLayers.filter(isTileLayer);
  const cellName = tileSet.cellName === undefined && cells.length === 1
    ? cells[0]?.name
    : nonEmptyString(tileSet.cellName, `tileSets[${index}].cellName`);
  if (cellName === undefined || !cells.some((cell) => cell.name === cellName)) {
    fail(`tileSets[${index}].cellName does not identify a manifest cell`);
  }

  return {
    id: nonEmptyString(tileSet.id, `tileSets[${index}].id`),
    cellName,
    format,
    url: nonEmptyString(tileSet.url, `tileSets[${index}].url`),
    minZoom,
    maxZoom,
    layers,
  };
}

function parseCell(value: unknown, index: number): ChartCell {
  const cell = record(value, `cells[${index}]`);
  const verticalDatum = cell.verticalDatum === undefined
    ? undefined
    : nonEmptyString(cell.verticalDatum, `cells[${index}].verticalDatum`);
  return {
    name: nonEmptyString(cell.name, `cells[${index}].name`),
    edition: integer(cell.edition, `cells[${index}].edition`, 1),
    updateNumber: integer(cell.updateNumber, `cells[${index}].updateNumber`, 0),
    issueDate: date(cell.issueDate, `cells[${index}].issueDate`),
    updateApplicationDate: date(cell.updateApplicationDate, `cells[${index}].updateApplicationDate`),
    usageBand: integer(cell.usageBand, `cells[${index}].usageBand`, 1, 6),
    compilationScale: integer(cell.compilationScale, `cells[${index}].compilationScale`, 1),
    ...(verticalDatum === undefined ? {} : { verticalDatum }),
    bounds: bounds(cell.bounds, `cells[${index}].bounds`),
  };
}

function bounds(value: unknown, path: string): Bounds {
  const values = array(value, path);
  if (values.length !== 4) fail(`${path} must contain four coordinates`);
  const result = values.map((coordinate, index) => number(coordinate, `${path}[${index}]`)) as Bounds;
  const [west, south, east, north] = result;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    fail(`${path} is not a valid west, south, east, north extent`);
  }
  return result;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path} must be a string`);
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = string(value, path);
  if (result.trim().length === 0) fail(`${path} must not be empty`);
  return result;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number`);
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, path);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    fail(`${path} must be an integer from ${minimum} through ${maximum}`);
  }
  return result;
}

function dateTime(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)) {
    fail(`${path} must be an ISO 8601 date-time`);
  }
  return result;
}

function date(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(`${path} must be an ISO 8601 date`);
  return result;
}

function isTileLayer(value: string): value is TileLayer {
  return (TILE_LAYERS as readonly string[]).includes(value);
}

function isDepthUnit(value: string): value is DepthUnit {
  return value === "metre" || value === "foot" || value === "fathom";
}

function fail(message: string): never {
  throw new ManifestError(`Invalid chart package manifest: ${message}`);
}
