import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectExchangeSet } from "./inventory.js";
import { validateManifest } from "./manifest.js";
import { CancelledCellError, convertCell, type ConvertCellOptions } from "./s57.js";

type Bounds = readonly [number, number, number, number];
type CellConverter = (options: ConvertCellOptions) => Promise<string>;

export interface ConvertExchangeSetOptions {
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly packageId: string;
  readonly packageName: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly userAgreement: string;
  readonly generatedAt?: string;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /** Process the first N cells in inventory order. Intended for smoke tests. */
  readonly limit?: number;
  readonly ogrinfo?: string;
  readonly ogr2ogr?: string;
}

interface CellManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly source: Record<string, unknown>;
  readonly bounds: Bounds;
  readonly depth: {
    readonly storedUnit: string;
    readonly displayUnit: string;
    readonly verticalDatums: readonly string[];
  };
  readonly tileSets: readonly Record<string, unknown>[];
  readonly cells: readonly Record<string, unknown>[];
}

/**
 * Converts every selected cell independently, then atomically publishes one
 * schema-v1 package whose tileSets and cells arrays cover the exchange set.
 */
export async function convertExchangeSet(
  options: ConvertExchangeSetOptions,
  converter: CellConverter = convertCell,
): Promise<string> {
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("limit must be a positive integer");
  }

  const inputDirectory = path.resolve(options.inputDirectory);
  const inventory = await inspectExchangeSet(inputDirectory);
  if (inventory.inputKind !== "directory") throw new Error("convert-exchange-set requires an extracted exchange-set directory");
  if (!inventory.valid) throw new Error(inventory.issues.map((issue) => issue.message).join("; "));
  const selectedCells = options.limit === undefined ? inventory.cells : inventory.cells.slice(0, options.limit);
  if (selectedCells.length === 0) throw new Error("The exchange set contains no cells to convert");

  const outputDirectory = path.resolve(options.outputDirectory);
  await requireAbsent(outputDirectory);
  const temporary = `${outputDirectory}.tmp-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(path.join(temporary, "work"), { recursive: true });
  await mkdir(path.join(temporary, "tiles"), { recursive: true });
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  try {
    const manifests: CellManifest[] = [];
    for (const inventoryCell of selectedCells) {
      if (inventoryCell.base === null) throw new Error(`No base cell found for ${inventoryCell.name}`);
      const baseCell = path.resolve(inputDirectory, inventoryCell.base);
      if (!isWithin(inputDirectory, baseCell)) throw new Error(`Cell path escapes the exchange-set directory: ${inventoryCell.base}`);
      const cellId = inventoryCell.name.toLowerCase();
      const workDirectory = path.join(temporary, "work", cellId);
      let manifestPath: string;
      try {
        manifestPath = await converter({
          baseCell,
          outputDirectory: workDirectory,
          packageId: `${options.packageId}-${cellId}`,
          packageName: `${options.packageName} — ${inventoryCell.name}`,
          sourceUrl: options.sourceUrl,
          retrievedAt: options.retrievedAt,
          userAgreement: options.userAgreement,
          generatedAt,
          ...(options.minZoom === undefined ? {} : { minZoom: options.minZoom }),
          ...(options.maxZoom === undefined ? {} : { maxZoom: options.maxZoom }),
          ...(options.ogrinfo === undefined ? {} : { ogrinfo: options.ogrinfo }),
          ...(options.ogr2ogr === undefined ? {} : { ogr2ogr: options.ogr2ogr }),
        });
      } catch (error: unknown) {
        if (error instanceof CancelledCellError) continue;
        throw error;
      }
      const manifest = await readCellManifest(manifestPath);
      const copiedTileSets: Record<string, unknown>[] = [];
      for (const [tileIndex, tileSet] of manifest.tileSets.entries()) {
        const sourceTile = requireRelativeTilePath(manifestPath, tileSet.url);
        const suffix = manifest.tileSets.length === 1 ? "" : `-${tileIndex + 1}`;
        const tileFilename = `${cellId}${suffix}.pmtiles`;
        await copyFile(sourceTile, path.join(temporary, "tiles", tileFilename));
        copiedTileSets.push({ ...tileSet, url: `./tiles/${tileFilename}` });
      }
      manifests.push({ ...manifest, tileSets: copiedTileSets });
    }

    const first = manifests[0];
    if (first === undefined) throw new Error("No cell manifests were generated");
    assertCompatibleManifests(manifests);
    await copyFile(path.resolve(options.userAgreement), path.join(temporary, "USER_AGREEMENT.txt"));
    const combined = {
      schemaVersion: 1,
      packageId: options.packageId,
      name: options.packageName,
      generatedAt,
      source: { ...first.source, userAgreementPath: "./USER_AGREEMENT.txt" },
      bounds: unionBounds(manifests.map((manifest) => manifest.bounds)),
      depth: {
        ...first.depth,
        verticalDatums: [...new Set(manifests.flatMap((manifest) => manifest.depth.verticalDatums))],
      },
      tileSets: manifests.flatMap((manifest) => manifest.tileSets),
      cells: manifests.flatMap((manifest) => manifest.cells),
    };
    const manifestPath = path.join(temporary, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(combined, null, 2)}\n`, "utf8");
    const validation = await validateManifest(manifestPath);
    if (!validation.valid) throw new Error(`Generated batch manifest does not conform to schema v1: ${JSON.stringify(validation.errors)}`);
    await rm(path.join(temporary, "work"), { recursive: true });
    await mkdir(path.dirname(outputDirectory), { recursive: true });
    await rename(temporary, outputDirectory);
    return path.join(outputDirectory, "manifest.json");
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function readCellManifest(manifestPath: string): Promise<CellManifest> {
  const result = await validateManifest(manifestPath);
  if (!result.valid) throw new Error(`Cell manifest does not conform to schema v1: ${JSON.stringify(result.errors)}`);
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.tileSets) || parsed.tileSets.length === 0 || !Array.isArray(parsed.cells)) {
    throw new Error(`Invalid cell manifest structure: ${manifestPath}`);
  }
  return parsed as unknown as CellManifest;
}

function requireRelativeTilePath(manifestPath: string, value: unknown): string {
  if (typeof value !== "string" || value === "" || path.isAbsolute(value) || /^[a-z][a-z\d+.-]*:/i.test(value)) {
    throw new Error(`Cell manifest tile URL must be a relative path: ${String(value)}`);
  }
  const manifestDirectory = path.dirname(path.resolve(manifestPath));
  const resolved = path.resolve(manifestDirectory, value);
  if (!isWithin(manifestDirectory, resolved)) throw new Error(`Cell manifest tile URL escapes its package: ${value}`);
  return resolved;
}

function assertCompatibleManifests(manifests: readonly CellManifest[]): void {
  const first = manifests[0];
  if (first === undefined) return;
  const sourceIdentity = JSON.stringify({ ...first.source, userAgreementPath: undefined });
  for (const manifest of manifests.slice(1)) {
    if (manifest.depth.storedUnit !== first.depth.storedUnit || manifest.depth.displayUnit !== first.depth.displayUnit) {
      throw new Error("Cell manifests use incompatible depth units");
    }
    if (JSON.stringify({ ...manifest.source, userAgreementPath: undefined }) !== sourceIdentity) {
      throw new Error("Cell manifests use incompatible source metadata");
    }
  }
}

function unionBounds(bounds: readonly Bounds[]): Bounds {
  return [
    Math.min(...bounds.map((item) => item[0])),
    Math.min(...bounds.map((item) => item[1])),
    Math.max(...bounds.map((item) => item[2])),
    Math.max(...bounds.map((item) => item[3])),
  ];
}

async function requireAbsent(target: string): Promise<void> {
  try {
    await lstat(target);
    throw new Error(`Output directory already exists: ${target}`);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
