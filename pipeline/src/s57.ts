import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectEntries } from "./inventory.js";
import { validateManifest } from "./manifest.js";
import { type Command, type CommandRunner, runCommand } from "./process.js";

const REQUIRED_LAYERS = ["COALNE", "DEPARE", "DEPCNT", "SOUNDG"] as const;
const INSPECTED_LAYERS = ["M_COVR", ...REQUIRED_LAYERS] as const;
const LAYER_NAMES = ["coastline", "depth-area", "depth-contour", "sounding"] as const;

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
  readonly features?: readonly { readonly properties?: unknown }[];
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
  readonly source: RequiredLayer;
  readonly outputLayer: (typeof LAYER_NAMES)[number];
  readonly properties: readonly string[];
}

const EXTRACTS: readonly ExtractSpec[] = [
  { source: "COALNE", outputLayer: "coastline", properties: [] },
  { source: "DEPARE", outputLayer: "depth-area", properties: ["DRVAL1 AS minimumDepth", "DRVAL2 AS maximumDepth"] },
  { source: "DEPCNT", outputLayer: "depth-contour", properties: ["VALDCO AS depth"] },
  { source: "SOUNDG", outputLayer: "sounding", properties: ["DEPTH AS depth"] },
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
  create: boolean,
  ogr2ogr = "ogr2ogr",
): Command {
  const properties = [
    ...spec.properties,
    `'${cell.name}' AS cell`,
    `${cell.usageBand} AS usageBand`,
    `${cell.compilationScale} AS compilationScale`,
  ];
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
      "OGRSQL",
      "-sql",
      `SELECT ${properties.join(", ")} FROM ${spec.source}`,
      path.resolve(output),
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
  const bounds = parseBounds(coverageLayer.geometryFields?.[0]?.extent, "M_COVR");
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
  return { cell, bounds, layers };
}

export async function convertCell(options: ConvertCellOptions, runner: CommandRunner = runCommand): Promise<string> {
  validateOptions(options);
  const baseCell = path.resolve(options.baseCell);
  const highestUpdate = await validateUpdateChain(baseCell);
  await requireNonemptyFile(options.userAgreement, "user agreement");

  const metadataResult = await runner(metadataCommand(baseCell, options.ogrinfo));
  const summaryResult = await runner(datasetSummaryCommand(baseCell, options.ogrinfo));
  const summaries = parseLayerSummaries(summaryResult.stdout);
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
    const extracts = EXTRACTS.filter((extract) => layers.includes(extract.source));
    for (const [index, extract] of extracts.entries()) {
      await runner(extractionCommand(baseCell, stagingDatabase, extract, cell, index === 0, options.ogr2ogr));
    }
    const tileFilename = `${options.packageId}.pmtiles`;
    const tilePath = path.join(temporary, tileFilename);
    await runner(tileCommand(tilePath, stagingDatabase, options.minZoom, options.maxZoom, options.ogr2ogr));
    await requireNonemptyFile(tilePath, "PMTiles output");
    const packageSummary = await runner(packageSummaryCommand(tilePath, options.ogrinfo));
    validatePackageSummary(packageSummary.stdout, extracts.map((extract) => extract.outputLayer));

    const agreementFilename = "USER_AGREEMENT.txt";
    await copyFile(path.resolve(options.userAgreement), path.join(temporary, agreementFilename));
    const manifest = createManifest(options, cell, bounds, tileFilename, agreementFilename, extracts.map((extract) => extract.outputLayer));
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
