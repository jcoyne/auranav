import type { ChartPackageManifest } from "../chart-package";
import { resolvePackageAssetUrl } from "../chart-package-url";
import type { Header, RangeResponse, Source } from "pmtiles";
import { FetchSource, FileSource, PMTiles } from "pmtiles";

const RECORDS_KEY = "chartplotter.offline-packages.v1";
const ROOT_DIRECTORY = "chartplotter";
const PACKAGES_DIRECTORY = "packages";
const MANIFEST_FILE = "manifest.json";
const AGREEMENT_FILE = "USER_AGREEMENT.txt";

export type OfflinePackageRecord = {
  schemaVersion: 1;
  manifestUrl: string;
  packageId: string;
  name: string;
  generatedAt: string;
  downloadedAt: string;
  directory: string;
  bytes: number;
  files: { url: string; name: string; bytes: number }[];
};

export type DownloadProgress = {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes?: number;
  currentFile: string;
};

type StorageNavigator = Navigator & {
  storage: StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
};

export function offlineStorageSupported(): boolean {
  return typeof navigator !== "undefined"
    && typeof (navigator as StorageNavigator).storage?.getDirectory === "function"
    && typeof localStorage !== "undefined";
}

export function offlinePackageFor(manifestUrl: URL): OfflinePackageRecord | undefined {
  return readRecords().find((record) => record.manifestUrl === manifestUrl.href);
}

export async function verifyOfflinePackage(record: OfflinePackageRecord): Promise<boolean> {
  try {
    const directory = await packageDirectoryHandle(record.directory, false);
    await directory.getFileHandle(MANIFEST_FILE);
    await directory.getFileHandle(AGREEMENT_FILE);
    for (const entry of record.files) {
      const file = await (await directory.getFileHandle(entry.name)).getFile();
      if (file.size !== entry.bytes) return false;
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
}

export async function cleanupInactivePackages(): Promise<void> {
  if (!offlineStorageSupported()) return;
  const active = new Set(readRecords().map((record) => record.directory));
  try {
    const packages = await packagesDirectoryHandle(false);
    const iterable = packages as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };
    for await (const name of iterable.keys()) {
      if (!active.has(name)) await packages.removeEntry(name, { recursive: true });
    }
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

export async function offlineAgreementUrl(record: OfflinePackageRecord): Promise<string> {
  const directory = await packageDirectoryHandle(record.directory, false);
  const file = await (await directory.getFileHandle(AGREEMENT_FILE)).getFile();
  return URL.createObjectURL(file);
}

export async function requestPersistentStorage(): Promise<boolean> {
  return navigator.storage.persist?.() ?? false;
}

export async function storageIsPersistent(): Promise<boolean> {
  return navigator.storage.persisted?.() ?? false;
}

export async function storageEstimate(): Promise<StorageEstimate> {
  return navigator.storage.estimate?.() ?? {};
}

export async function downloadChartPackage(
  manifest: ChartPackageManifest,
  manifestUrl: URL,
  progress: (value: DownloadProgress) => void,
): Promise<OfflinePackageRecord> {
  if (!offlineStorageSupported()) throw new Error("Offline chart storage is not supported by this browser.");
  const tileSets = manifest.tileSets.filter((tileSet) => tileSet.format === "pmtiles");
  const urls = tileSets.map((tileSet) => resolvePackageAssetUrl(tileSet.url, manifestUrl));
  const directory = `${directoryName(manifest.packageId, manifest.generatedAt)}-${uniqueSuffix()}`;
  const packageDirectory = await packageDirectoryHandle(directory, true);
  const files: OfflinePackageRecord["files"] = [];
  let completedBytes = 0;
  let activated = false;

  try {
    for (const [index, url] of urls.entries()) {
      const name = `${index.toString().padStart(4, "0")}.pmtiles`;
      progress({ completedFiles: index, totalFiles: urls.length + 1, completedBytes, currentFile: tileSets[index]?.cellName ?? name });
      const fileHandle = await packageDirectory.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      let fileBytes = 0;
      try {
        const response = await fetch(url);
        if (!response.ok || !response.body) {
          throw new Error(`Chart download failed for ${tileSets[index]?.cellName ?? url.href} (${response.status} ${response.statusText}).`);
        }
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          fileBytes += value.byteLength;
          progress({ completedFiles: index, totalFiles: urls.length + 1, completedBytes: completedBytes + fileBytes, currentFile: tileSets[index]?.cellName ?? name });
        }
        await writable.close();
        const expectedBytes = decodedContentLength(response.headers);
        if (expectedBytes !== undefined && expectedBytes !== fileBytes) {
          throw new Error(`Chart download was incomplete for ${tileSets[index]?.cellName ?? url.href}.`);
        }
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      const file = await fileHandle.getFile();
      const header = await new PMTiles(new FileSource(file)).getHeader();
      if (archiveExtent(header) > file.size) {
        throw new Error(`Chart download was incomplete for ${tileSets[index]?.cellName ?? url.href}.`);
      }
      completedBytes += fileBytes;
      files.push({ url: url.href, name, bytes: fileBytes });
    }

    progress({ completedFiles: urls.length, totalFiles: urls.length + 1, completedBytes, currentFile: "Usage agreement" });
    await downloadSmallFile(
      packageDirectory,
      AGREEMENT_FILE,
      resolvePackageAssetUrl(manifest.source.userAgreementPath, manifestUrl),
    );
    await writeTextFile(packageDirectory, MANIFEST_FILE, JSON.stringify(manifest));

    const record: OfflinePackageRecord = {
      schemaVersion: 1,
      manifestUrl: manifestUrl.href,
      packageId: manifest.packageId,
      name: manifest.name,
      generatedAt: manifest.generatedAt,
      downloadedAt: new Date().toISOString(),
      directory,
      bytes: completedBytes,
      files,
    };
    // This is the activation pointer. All package members coexist in the
    // unique staging directory and every PMTiles header has been verified.
    writeRecords([...readRecords().filter((item) => item.manifestUrl !== manifestUrl.href), record]);
    activated = true;
    // Presentation code must not roll back a completely activated package.
    try {
      progress({ completedFiles: urls.length + 1, totalFiles: urls.length + 1, completedBytes, currentFile: "Complete" });
    } catch {
      // The next render reconstructs status from the active record.
    }
    return record;
  } catch (error) {
    if (!activated) await removeDirectory(directory);
    throw error;
  }
}

export async function removeOfflinePackage(record: OfflinePackageRecord): Promise<void> {
  writeRecords(readRecords().filter((item) => item.manifestUrl !== record.manifestUrl));
  await removeDirectory(record.directory);
}

export async function readOfflineManifest(manifestUrl: URL): Promise<unknown | undefined> {
  const record = offlinePackageFor(manifestUrl);
  if (!record) return undefined;
  try {
    const directory = await packageDirectoryHandle(record.directory, false);
    const handle = await directory.getFileHandle(MANIFEST_FILE);
    return JSON.parse(await (await handle.getFile()).text()) as unknown;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
    throw error;
  }
}

export function createChartSource(url: string): Source {
  const file = readRecords().flatMap((record) => record.files.map((entry) => ({ record, entry })))
    .find(({ entry }) => entry.url === url);
  return file ? new OfflineFileSource(url, file.record.directory, file.entry.name, file.entry.bytes) : new FetchSource(url);
}

class OfflineFileSource implements Source {
  private readonly fallback: FetchSource;

  constructor(
    private readonly url: string,
    private readonly directory: string,
    private readonly name: string,
    private readonly expectedBytes: number,
  ) {
    this.fallback = new FetchSource(url);
  }

  getKey(): string {
    // Protocol registrations are keyed by the original archive URL.
    return this.url;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    try {
      const directory = await packageDirectoryHandle(this.directory, false);
      const file = await (await directory.getFileHandle(this.name)).getFile();
      if (file.size !== this.expectedBytes) return this.fallback.getBytes(offset, length);
      if (offset < 0 || length < 0 || offset + length > file.size) {
        throw new Error(`Offline chart byte range is outside ${this.url}.`);
      }
      return { data: await file.slice(offset, offset + length).arrayBuffer() };
    } catch (error) {
      // A browser may evict best-effort OPFS while retaining localStorage.
      // Online fallback keeps the viewer usable and exposes ordinary fetch errors offline.
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return this.fallback.getBytes(offset, length);
      }
      throw error;
    }
  }
}

async function packageDirectoryHandle(name: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  return (await packagesDirectoryHandle(create)).getDirectoryHandle(name, { create });
}

async function packagesDirectoryHandle(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await (navigator as StorageNavigator).storage.getDirectory?.();
  if (!root) throw new Error("Offline chart storage is not supported by this browser.");
  const app = await root.getDirectoryHandle(ROOT_DIRECTORY, { create });
  return app.getDirectoryHandle(PACKAGES_DIRECTORY, { create });
}

async function removeDirectory(name: string): Promise<void> {
  try {
    const root = await (navigator as StorageNavigator).storage.getDirectory?.();
    if (!root) return;
    const app = await root.getDirectoryHandle(ROOT_DIRECTORY);
    const packages = await app.getDirectoryHandle(PACKAGES_DIRECTORY);
    await packages.removeEntry(name, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
  }
}

function directoryName(packageId: string, generatedAt: string): string {
  return `${packageId}-${generatedAt}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function uniqueSuffix(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// Content-Length describes the bytes on the wire, while fetch hands back a decoded
// body. A host that applies transfer compression to .pmtiles (GitHub Pages gzips
// application/octet-stream) therefore reports a length smaller than the file that
// gets written, so the header is only a completeness signal for an unencoded body.
// Archive extents are checked separately, which covers truncation either way.
function decodedContentLength(headers: Headers): number | undefined {
  const encoding = headers.get("content-encoding");
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity") return undefined;
  const header = headers.get("content-length");
  if (header === null) return undefined;
  const value = Number(header);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

// The last byte any section of a PMTiles archive claims. A truncated download
// still parses as a header, so compare this with the size actually stored.
function archiveExtent(header: Header): number {
  return Math.max(
    header.rootDirectoryOffset + header.rootDirectoryLength,
    header.jsonMetadataOffset + header.jsonMetadataLength,
    header.leafDirectoryOffset + (header.leafDirectoryLength ?? 0),
    header.tileDataOffset + (header.tileDataLength ?? 0),
  ) || 0;
}

async function downloadSmallFile(directory: FileSystemDirectoryHandle, name: string, url: URL): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Package usage agreement download failed (${response.status} ${response.statusText}).`);
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(await response.arrayBuffer());
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

async function writeTextFile(directory: FileSystemDirectoryHandle, name: string, contents: string): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(contents);
  await writable.close();
}

function readRecords(): OfflinePackageRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECORDS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord);
  } catch {
    return [];
  }
}

function writeRecords(records: OfflinePackageRecord[]): void {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

function isRecord(value: unknown): value is OfflinePackageRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<OfflinePackageRecord>;
  return record.schemaVersion === 1 && typeof record.manifestUrl === "string"
    && typeof record.packageId === "string" && typeof record.name === "string"
    && typeof record.generatedAt === "string" && typeof record.downloadedAt === "string"
    && typeof record.directory === "string" && typeof record.bytes === "number"
    && Array.isArray(record.files) && record.files.every((file) => typeof file.url === "string"
      && typeof file.name === "string" && typeof file.bytes === "number");
}
