import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchSource, PMTiles } from "pmtiles";
import type { ChartPackageManifest } from "../chart-package";
import {
  cleanupInactivePackages,
  createChartSource,
  downloadChartPackage,
  offlinePackageFor,
  verifyOfflinePackage,
  type OfflinePackageRecord,
} from "./chart-store";

const recordKey = "chartplotter.offline-packages.v1";

describe("offline chart records", () => {
  let root: MemoryDirectory;

  beforeEach(() => {
    localStorage.clear();
    root = new MemoryDirectory();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => root as unknown as FileSystemDirectoryHandle),
        persist: vi.fn(async () => true),
        persisted: vi.fn(async () => true),
        estimate: vi.fn(async () => ({ usage: 0, quota: 1_000_000 })),
      },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("ignores corrupt saved metadata", () => {
    localStorage.setItem(recordKey, "not json");
    expect(offlinePackageFor(new URL("https://example.test/manifest.json"))).toBeUndefined();
  });

  it("keeps the archive URL as the PMTiles protocol key for offline files", () => {
    const url = "https://example.test/charts/cell.pmtiles";
    localStorage.setItem(recordKey, JSON.stringify([{
      schemaVersion: 1,
      manifestUrl: "https://example.test/charts/manifest.json",
      packageId: "test",
      name: "Test",
      generatedAt: "2026-09-18T00:00:00Z",
      downloadedAt: "2026-09-18T01:00:00Z",
      directory: "test-version",
      bytes: 10,
      files: [{ url, name: "0000.pmtiles", bytes: 10 }],
    }]));

    expect(createChartSource(url).getKey()).toBe(url);
  });

  it("uses the network source for an archive that was not downloaded", () => {
    expect(createChartSource("https://example.test/other.pmtiles")).toBeInstanceOf(FetchSource);
  });

  it("stages and validates every file before activating a package", async () => {
    vi.spyOn(PMTiles.prototype, "getHeader").mockResolvedValue({} as Awaited<ReturnType<PMTiles["getHeader"]>>);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      // The active pointer must not appear while any staged member is downloading.
      expect(offlinePackageFor(manifestUrl)).toBeUndefined();
      const url = String(input);
      if (url.endsWith("USER_AGREEMENT.txt")) return new Response("NOAA terms");
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } });
    });

    const progress = vi.fn();
    const record = await downloadChartPackage(manifest, manifestUrl, progress);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(record.files).toEqual([{ url: "https://example.test/charts/cell.pmtiles", name: "0000.pmtiles", bytes: 4 }]);
    expect(offlinePackageFor(manifestUrl)).toEqual(record);
    expect(await verifyOfflinePackage(record)).toBe(true);
    const packageDirectory = root.directory("chartplotter").directory("packages").directory(record.directory);
    expect(packageDirectory.file("manifest.json").text()).toContain('"packageId":"test-package"');
    expect(packageDirectory.file("USER_AGREEMENT.txt").text()).toBe("NOAA terms");
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ completedFiles: 2, totalFiles: 2, currentFile: "Complete" }));
  });

  it("preserves the active package and removes staging after an interrupted update", async () => {
    const previous = savedRecord("active-version", 4);
    localStorage.setItem(recordKey, JSON.stringify([previous]));
    await seedPackage(root, previous, new Uint8Array([1, 2, 3, 4]));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection lost"));

    await expect(downloadChartPackage(manifest, manifestUrl, vi.fn())).rejects.toThrow("connection lost");

    expect(offlinePackageFor(manifestUrl)).toEqual(previous);
    const packages = root.directory("chartplotter").directory("packages");
    expect([...packages.directories.keys()]).toEqual(["active-version"]);
    expect(await verifyOfflinePackage(previous)).toBe(true);
  });

  it("does not roll back activation when the final progress renderer throws", async () => {
    vi.spyOn(PMTiles.prototype, "getHeader").mockResolvedValue({} as Awaited<ReturnType<PMTiles["getHeader"]>>);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).endsWith("USER_AGREEMENT.txt")
      ? new Response("NOAA terms")
      : new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } }));
    const progress = vi.fn((value: { currentFile: string }) => {
      if (value.currentFile === "Complete") throw new Error("detached UI");
    });

    const record = await downloadChartPackage(manifest, manifestUrl, progress);

    expect(offlinePackageFor(manifestUrl)).toEqual(record);
    expect(await verifyOfflinePackage(record)).toBe(true);
  });

  it("accepts an archive whose Content-Length describes a compressed transfer", async () => {
    // A static host may gzip .pmtiles, and fetch hands back the decoded body, so the
    // header describes fewer bytes than the download legitimately writes.
    vi.spyOn(PMTiles.prototype, "getHeader").mockResolvedValue(pmtilesHeader(4));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).endsWith("USER_AGREEMENT.txt")
      ? new Response("NOAA terms")
      : new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "2", "content-encoding": "gzip" } }));

    const record = await downloadChartPackage(manifest, manifestUrl, vi.fn());

    expect(record.files).toEqual([{ url: "https://example.test/charts/cell.pmtiles", name: "0000.pmtiles", bytes: 4 }]);
    expect(offlinePackageFor(manifestUrl)).toEqual(record);
  });

  it("rejects an archive that stops short of the extent its header claims", async () => {
    vi.spyOn(PMTiles.prototype, "getHeader").mockResolvedValue(pmtilesHeader(64));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).endsWith("USER_AGREEMENT.txt")
      ? new Response("NOAA terms")
      : new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-encoding": "gzip" } }));

    await expect(downloadChartPackage(manifest, manifestUrl, vi.fn())).rejects.toThrow("incomplete");

    expect(offlinePackageFor(manifestUrl)).toBeUndefined();
    expect([...root.directory("chartplotter").directory("packages").directories.keys()]).toEqual([]);
  });

  it("detects a truncated saved archive and cleans abandoned staging directories", async () => {
    const active = savedRecord("active-version", 10);
    localStorage.setItem(recordKey, JSON.stringify([active]));
    await seedPackage(root, active, new Uint8Array([1, 2, 3]));
    const packages = root.directory("chartplotter").directory("packages");
    packages.directories.set("abandoned-staging", new MemoryDirectory());

    expect(await verifyOfflinePackage(active)).toBe(false);
    await cleanupInactivePackages();

    expect(packages.directories.has("active-version")).toBe(true);
    expect(packages.directories.has("abandoned-staging")).toBe(false);
  });
});

const manifestUrl = new URL("https://example.test/charts/manifest.json");
const manifest: ChartPackageManifest = {
  schemaVersion: 1,
  packageId: "test-package",
  name: "Test charts",
  generatedAt: "2026-09-18T00:00:00Z",
  source: {
    publisher: "NOAA Office of Coast Survey",
    product: "NOAA ENC",
    downloadUrl: "https://example.test/source.zip",
    retrievedAt: "2026-09-18T00:00:00Z",
    userAgreementPath: "USER_AGREEMENT.txt",
  },
  bounds: [-90, 40, -80, 50],
  depth: { storedUnit: "metre", displayUnit: "metre", verticalDatums: ["MLLW"] },
  cells: [{
    name: "CELL",
    edition: 1,
    updateNumber: 0,
    issueDate: "2026-09-18",
    updateApplicationDate: "2026-09-18",
    usageBand: 4,
    compilationScale: 20_000,
    bounds: [-90, 40, -80, 50],
  }],
  tileSets: [{
    id: "cell",
    cellName: "CELL",
    format: "pmtiles",
    url: "cell.pmtiles",
    minZoom: 0,
    maxZoom: 14,
    layers: ["coverage"],
  }],
};

// A header whose sections all end at `extent`, the smallest archive size it describes.
function pmtilesHeader(extent: number): Awaited<ReturnType<PMTiles["getHeader"]>> {
  return {
    rootDirectoryOffset: 0,
    rootDirectoryLength: extent,
    jsonMetadataOffset: 0,
    jsonMetadataLength: extent,
    leafDirectoryOffset: 0,
    leafDirectoryLength: extent,
    tileDataOffset: 0,
    tileDataLength: extent,
  } as Awaited<ReturnType<PMTiles["getHeader"]>>;
}

function savedRecord(directory: string, bytes: number): OfflinePackageRecord {
  return {
    schemaVersion: 1,
    manifestUrl: manifestUrl.href,
    packageId: manifest.packageId,
    name: manifest.name,
    generatedAt: manifest.generatedAt,
    downloadedAt: "2026-09-18T01:00:00Z",
    directory,
    bytes,
    files: [{ url: "https://example.test/charts/cell.pmtiles", name: "0000.pmtiles", bytes }],
  };
}

async function seedPackage(root: MemoryDirectory, record: OfflinePackageRecord, tileBytes: Uint8Array): Promise<void> {
  const packages = root.ensureDirectory("chartplotter").ensureDirectory("packages");
  const directory = packages.ensureDirectory(record.directory);
  directory.files.set("0000.pmtiles", new MemoryFile(new Uint8Array(tileBytes)));
  directory.files.set("manifest.json", new MemoryFile(new TextEncoder().encode(JSON.stringify(manifest))));
  directory.files.set("USER_AGREEMENT.txt", new MemoryFile(new TextEncoder().encode("NOAA terms")));
}

class MemoryFile {
  constructor(public bytes = new Uint8Array()) {}

  text(): string {
    return new TextDecoder().decode(this.bytes);
  }

  browserFile(name: string): File {
    return new File([this.bytes], name);
  }
}

class MemoryDirectory {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();

  ensureDirectory(name: string): MemoryDirectory {
    const existing = this.directories.get(name);
    if (existing) return existing;
    const directory = new MemoryDirectory();
    this.directories.set(name, directory);
    return directory;
  }

  directory(name: string): MemoryDirectory {
    const directory = this.directories.get(name);
    if (!directory) throw new Error(`Missing test directory ${name}`);
    return directory;
  }

  file(name: string): MemoryFile {
    const file = this.files.get(name);
    if (!file) throw new Error(`Missing test file ${name}`);
    return file;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
    const directory = this.directories.get(name);
    if (directory) return directory as unknown as FileSystemDirectoryHandle;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    return this.ensureDirectory(name) as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new MemoryFile();
      this.files.set(name, file);
    }
    if (!file) throw new DOMException("Not found", "NotFoundError");
    const memoryFile = file;
    return {
      getFile: async () => memoryFile.browserFile(name),
      createWritable: async () => {
        let bytes = new Uint8Array();
        return {
          write: async (value: FileSystemWriteChunkType) => {
            if (typeof value === "string") bytes = new TextEncoder().encode(value);
            else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
            else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
            else throw new Error("Unsupported memory write");
          },
          close: async () => { memoryFile.bytes = bytes; },
          abort: async () => undefined,
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.directories.delete(name) && !this.files.delete(name)) throw new DOMException("Not found", "NotFoundError");
  }

  async *keys(): AsyncIterableIterator<string> {
    yield* this.directories.keys();
    yield* this.files.keys();
  }
}
