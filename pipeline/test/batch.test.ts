import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertExchangeSet } from "../src/batch.js";
import { CancelledCellError, type ConvertCellOptions } from "../src/s57.js";

const generatedAt = "2026-09-17T12:00:00Z";
const retrievedAt = "2026-09-17T11:00:00Z";

describe("convertExchangeSet", () => {
  it("keeps whole cells whose coverage meets the requested region and drops the rest", async () => {
    const fixture = await exchangeSet(["US2BBBBB", "US1AAAAA"]);
    const output = path.join(fixture.root, "output");
    const converted: string[] = [];
    const extents: Record<string, number[]> = {
      US1AAAAA: [-92, 46.5, -91, 47.5],   // inside the region
      US2BBBBB: [-88, 43, -87, 44],       // Lake Michigan, outside it
    };
    const runner = async (command: { readonly args: readonly string[] }) => {
      const cell = path.basename(String(command.args.at(-2)), ".000");
      return {
        stdout: JSON.stringify({
          driverShortName: "S57",
          layers: [{ name: "M_COVR", geometryFields: [{ extent: extents[cell] }] }],
        }),
        stderr: "",
      };
    };

    const manifestPath = await convertExchangeSet(
      { ...options(fixture.input, fixture.agreement, output), bounds: [-93, 46.4, -89.3, 48] },
      async (cellOptions) => {
        converted.push(path.basename(cellOptions.baseCell, ".000"));
        return await fakeConvertCell(cellOptions, extents[path.basename(cellOptions.baseCell, ".000")] as [number, number, number, number]);
      },
      runner,
    );

    // A cell is kept or dropped whole: its coverage metadata describes its full
    // extent, so clipping the tiles would leave that metadata overstating them.
    expect(converted).toEqual(["US1AAAAA"]);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { cells: { name: string }[] };
    expect(manifest.cells.map((cell) => cell.name)).toEqual(["US1AAAAA"]);
  });

  it("combines sorted cell conversions into one atomic package and can limit a smoke test", async () => {
    const fixture = await exchangeSet(["US2BBBBB", "US1AAAAA"]);
    const output = path.join(fixture.root, "output");
    const converted: string[] = [];

    const manifestPath = await convertExchangeSet(options(fixture.input, fixture.agreement, output, 1), async (cellOptions) => {
      converted.push(path.basename(cellOptions.baseCell, ".000"));
      return await fakeConvertCell(cellOptions, [-88, 42, -87, 43]);
    });

    expect(converted).toEqual(["US1AAAAA"]);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      bounds: number[];
      source: { userAgreementPath: string };
      tileSets: { cellName: string; url: string }[];
      cells: { name: string }[];
    };
    expect(manifest.bounds).toEqual([-88, 42, -87, 43]);
    expect(manifest.source.userAgreementPath).toBe("./USER_AGREEMENT.txt");
    expect(manifest.tileSets).toEqual([expect.objectContaining({ cellName: "US1AAAAA", url: "./tiles/us1aaaaa.pmtiles" })]);
    expect(manifest.cells.map((cell) => cell.name)).toEqual(["US1AAAAA"]);
    expect(await readFile(path.join(output, "tiles", "us1aaaaa.pmtiles"), "utf8")).toBe("tile-US1AAAAA");
    expect((await readdir(output)).sort()).toEqual(["USER_AGREEMENT.txt", "manifest.json", "tiles"]);
  });

  it("unions bounds and preserves one tileSet-to-cell owner per converted cell", async () => {
    const fixture = await exchangeSet(["US1AAAAA", "US2BBBBB"]);
    const output = path.join(fixture.root, "output");
    const bounds = new Map([
      ["US1AAAAA", [-90, 40, -88, 42] as const],
      ["US2BBBBB", [-89, 41, -85, 45] as const],
    ]);
    const manifestPath = await convertExchangeSet(options(fixture.input, fixture.agreement, output), async (cellOptions) => {
      const name = path.basename(cellOptions.baseCell, ".000");
      return await fakeConvertCell(cellOptions, bounds.get(name) ?? [-1, -1, 1, 1]);
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      bounds: number[];
      tileSets: { cellName: string }[];
      cells: { name: string }[];
    };
    expect(manifest.bounds).toEqual([-90, 40, -85, 45]);
    expect(manifest.tileSets.map((tileSet) => tileSet.cellName)).toEqual(["US1AAAAA", "US2BBBBB"]);
    expect(manifest.cells.map((cell) => cell.name)).toEqual(["US1AAAAA", "US2BBBBB"]);
  });

  it("bounds parallel work while preserving inventory order", async () => {
    const fixture = await exchangeSet(["US1AAAAA", "US2BBBBB", "US3CCCCC"]);
    const output = path.join(fixture.root, "output");
    let active = 0;
    let maximumActive = 0;
    const manifestPath = await convertExchangeSet({ ...options(fixture.input, fixture.agreement, output), jobs: 2 }, async (cellOptions) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return await fakeConvertCell(cellOptions, [-90, 40, -85, 45]);
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { cells: { name: string }[] };
    expect(maximumActive).toBe(2);
    expect(manifest.cells.map((cell) => cell.name)).toEqual(["US1AAAAA", "US2BBBBB", "US3CCCCC"]);
  });

  it("removes all staged output when any cell conversion fails", async () => {
    const fixture = await exchangeSet(["US1AAAAA", "US2BBBBB"]);
    const output = path.join(fixture.root, "output");
    let count = 0;
    await expect(convertExchangeSet(options(fixture.input, fixture.agreement, output), async (cellOptions) => {
      count += 1;
      if (count === 2) throw new Error("simulated conversion failure");
      return await fakeConvertCell(cellOptions, [-90, 40, -88, 42]);
    })).rejects.toThrow("simulated conversion failure");
    await expect(readFile(path.join(output, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(fixture.root)).some((entry) => entry.startsWith("output.tmp-"))).toBe(false);
  });

  it("omits cancelled edition-zero cells from the published package", async () => {
    const fixture = await exchangeSet(["US1AAAAA", "US2BBBBB"]);
    const output = path.join(fixture.root, "output");
    const manifestPath = await convertExchangeSet(options(fixture.input, fixture.agreement, output), async (cellOptions) => {
      const name = path.basename(cellOptions.baseCell, ".000");
      if (name === "US1AAAAA") throw new CancelledCellError(name);
      return await fakeConvertCell(cellOptions, [-89, 41, -85, 45]);
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      tileSets: { cellName: string }[];
      cells: { name: string }[];
    };
    expect(manifest.tileSets.map((tileSet) => tileSet.cellName)).toEqual(["US2BBBBB"]);
    expect(manifest.cells.map((cell) => cell.name)).toEqual(["US2BBBBB"]);
  });

  it("rejects invalid update chains before starting conversion", async () => {
    const fixture = await exchangeSet(["US1AAAAA"]);
    await writeFile(path.join(fixture.input, "US1AAAAA.002"), "update");
    let called = false;
    await expect(convertExchangeSet(options(fixture.input, fixture.agreement, path.join(fixture.root, "output")), async () => {
      called = true;
      throw new Error("unexpected");
    })).rejects.toThrow("missing sequential update 001");
    expect(called).toBe(false);
  });

  it("rejects unsafe concurrency limits", async () => {
    const fixture = await exchangeSet(["US1AAAAA"]);
    await expect(convertExchangeSet({
      ...options(fixture.input, fixture.agreement, path.join(fixture.root, "output")),
      jobs: 0,
    })).rejects.toThrow("jobs must be an integer from 1 through 16");
  });
});

function options(inputDirectory: string, userAgreement: string, outputDirectory: string, limit?: number) {
  return {
    inputDirectory,
    userAgreement,
    outputDirectory,
    packageId: "wisconsin-enc",
    packageName: "Wisconsin NOAA ENCs",
    sourceUrl: "https://charts.noaa.gov/ENCs/WI_ENCs.zip",
    retrievedAt,
    generatedAt,
    ...(limit === undefined ? {} : { limit }),
  };
}

async function exchangeSet(cells: readonly string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "chartplotter-batch-test-"));
  const input = path.join(root, "ENC_ROOT");
  await mkdir(input);
  for (const cell of cells) await writeFile(path.join(input, `${cell}.000`), "base");
  const agreement = path.join(input, "USERAGREEMENT.TXT");
  await writeFile(agreement, "terms");
  return { root, input, agreement };
}

async function fakeConvertCell(options: ConvertCellOptions, bounds: readonly [number, number, number, number]): Promise<string> {
  await mkdir(options.outputDirectory, { recursive: true });
  const name = path.basename(options.baseCell, ".000");
  const tileFilename = `${options.packageId}.pmtiles`;
  await writeFile(path.join(options.outputDirectory, tileFilename), `tile-${name}`);
  await writeFile(path.join(options.outputDirectory, "USER_AGREEMENT.txt"), "terms");
  const manifest = {
    schemaVersion: 1,
    packageId: options.packageId,
    name: options.packageName,
    generatedAt: options.generatedAt,
    source: {
      publisher: "NOAA Office of Coast Survey",
      product: "NOAA ENC",
      downloadUrl: options.sourceUrl,
      retrievedAt: options.retrievedAt,
      userAgreementPath: "./USER_AGREEMENT.txt",
    },
    bounds,
    depth: { storedUnit: "metre", displayUnit: "foot", verticalDatums: ["test datum"] },
    tileSets: [{
      id: `${name.toLowerCase()}-chart`, cellName: name, format: "pmtiles", url: `./${tileFilename}`,
      minZoom: 0, maxZoom: 16, layers: ["coastline", "depth-area", "depth-contour", "sounding"],
    }],
    cells: [{
      name, edition: 1, updateNumber: 0, issueDate: "2026-09-01", updateApplicationDate: "2026-09-01",
      usageBand: Number(name[2]), compilationScale: 90000, verticalDatum: "test datum", bounds,
    }],
  };
  const manifestPath = path.join(options.outputDirectory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return manifestPath;
}
