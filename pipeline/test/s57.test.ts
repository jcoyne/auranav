import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  coverageCommand,
  datasetSummaryCommand,
  extractionCommand,
  metadataCommand,
  parseLayerSummaries,
  parseMetadata,
  tileCommand,
} from "../src/s57.js";

const baseCell = path.resolve("fixtures/US4WI1DP.000");
const properties = {
  DSID_DSNM: "US4WI1DP.000",
  DSID_EDTN: "1",
  DSID_UPDN: "4",
  DSID_UADT: "20231221",
  DSID_ISDT: "20251208",
  DSPM_VDAT: 25,
  DSPM_SDAT: 25,
  DSPM_CSCL: 90000,
  DSPM_DUNI: 1,
  DSPM_HUNI: 1,
};

function metadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    driverShortName: "S57",
    layers: [{ name: "DSID", features: [{ properties: { ...properties, ...overrides } }] }],
  });
}

function summaries(overrides: Partial<Record<"M_COVR" | "COALNE" | "DEPARE" | "DEPCNT" | "SOUNDG" | "LIGHTS", object>> = {}) {
  return new Map([
    ["M_COVR" as const, JSON.stringify(overrides.M_COVR ?? coverageSummary())],
    ["COALNE" as const, JSON.stringify(overrides.COALNE ?? summary("COALNE", 27, [-87.9, 42.9, -87.6, 43.2]))],
    ["DEPARE" as const, JSON.stringify(overrides.DEPARE ?? summary("DEPARE", 33, [-87.85, 42.95, -87.65, 43.15]))],
    ["DEPCNT" as const, JSON.stringify(overrides.DEPCNT ?? summary("DEPCNT", 36, [-87.8, 43, -87.7, 43.1]))],
    ["SOUNDG" as const, JSON.stringify(overrides.SOUNDG ?? summary("SOUNDG", 335, [-87.82, 42.98, -87.68, 43.12]))],
    ["LIGHTS" as const, JSON.stringify(overrides.LIGHTS ?? summary("LIGHTS", 12, [-87.81, 42.99, -87.69, 43.11]))],
  ]);
}

function coverageSummary(): object {
  return {
    driverShortName: "S57",
    layers: [{
      name: "M_COVR",
      featureCount: 1,
      // Deliberately wider than the feature to ensure bounds use CATCOV=1 geometry.
      geometryFields: [{ extent: [-88, 42, -87, 44] }],
      features: [{
        properties: { CATCOV: 1 },
        geometry: { type: "Polygon", coordinates: [[[-87.9, 42.9], [-87.6, 42.9], [-87.6, 43.2], [-87.9, 43.2], [-87.9, 42.9]]] },
      }],
    }],
  };
}

function summary(name: string, featureCount: number, extent: number[]): object {
  return { driverShortName: "S57", layers: [{ name, featureCount, geometryFields: [{ extent }] }] };
}

describe("S-57 commands", () => {
  it("constructs update-aware ogrinfo commands without a shell", () => {
    expect(metadataCommand(baseCell)).toEqual({
      executable: "ogrinfo",
      args: ["-ro", "-json", "-features", "-oo", "UPDATES=APPLY", baseCell, "DSID"],
    });
    expect(datasetSummaryCommand(baseCell).args).toEqual([
      "-ro", "-json", "-summary", "-oo", "UPDATES=APPLY", "-oo", "SPLIT_MULTIPOINT=ON", "-oo",
      "ADD_SOUNDG_DEPTH=ON", baseCell,
    ]);
    expect(coverageCommand(baseCell).args).toEqual([
      "-ro", "-json", "-features", "-oo", "UPDATES=APPLY", "-where", "CATCOV = 1", baseCell, "M_COVR",
    ]);
  });

  it("discovers the supported layers present in a dataset summary", () => {
    const parsed = parseLayerSummaries(JSON.stringify({
      driverShortName: "S57",
      layers: [
        { name: "M_COVR", featureCount: 1, geometryFields: [{ extent: [-88, 42, -87, 43] }] },
        { name: "DEPARE", featureCount: 2, geometryFields: [{ extent: [-88, 42, -87, 43] }] },
      ],
    }));
    expect([...parsed.keys()]).toEqual(["M_COVR", "DEPARE"]);
  });

  it("constructs extraction SQL with stable layer properties", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", {
      source: "SOUNDG",
      outputLayer: "sounding",
      properties: ["DEPTH AS depth"],
    }, parsed, true);

    expect(command.executable).toBe("ogr2ogr");
    expect(command.args).toContain("GPKG");
    expect(command.args).toContain("sounding");
    expect(command.args).toContain("UPDATES=APPLY");
    expect(command.args).toContain("SPLIT_MULTIPOINT=ON");
    expect(command.args).toContain("ADD_SOUNDG_DEPTH=ON");
    expect(command.args).toContain("SELECT DEPTH AS depth, 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale FROM SOUNDG");
  });

  it("extracts navigation-light attributes under stable property names", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", {
      source: "LIGHTS",
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
    }, parsed, true);

    expect(command.args).toContain("light");
    expect(command.args).toContain(
      "SELECT COLOUR AS color, LITCHR AS characteristic, SIGGRP AS signalGroup, SIGPER AS periodSeconds, HEIGHT AS heightMetres, VALNMR AS nominalRangeNm, SECTR1 AS sectorStart, SECTR2 AS sectorEnd, ORIENT AS orientation, VERDAT AS heightDatum, CATLIT AS category, STATUS AS status, 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale FROM LIGHTS",
    );
  });

  it("extracts only positive M_COVR polygons as stable coverage", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", {
      source: "M_COVR",
      outputLayer: "coverage",
      properties: [],
      where: "CATCOV = 1",
    }, parsed, true);

    expect(command.args).toContain("coverage");
    expect(command.args).toContain("SELECT 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale FROM M_COVR WHERE CATCOV = 1");
  });

  it("constructs deterministic native GDAL PMTiles output", () => {
    expect(tileCommand("chart.pmtiles", "layers.gpkg", 2, 15).args).toEqual([
      "-f", "PMTiles", "-overwrite", "-dsco", "MINZOOM=2", "-dsco", "MAXZOOM=15",
      path.resolve("chart.pmtiles"), path.resolve("layers.gpkg"),
    ]);
  });
});

describe("parseMetadata", () => {
  it("preserves applied DSID/DSPM metadata and uses M_COVR bounds", () => {
    expect(parseMetadata(metadata(), summaries())).toEqual({
      cell: {
        name: "US4WI1DP",
        edition: 1,
        updateNumber: 4,
        issueDate: "2025-12-08",
        updateApplicationDate: "2023-12-21",
        usageBand: 4,
        compilationScale: 90000,
        verticalDatum: "International Great Lakes Datum 1985",
        soundingDatum: "International Great Lakes Datum 1985",
      },
      bounds: [-87.9, 42.9, -87.6, 43.2],
      layers: ["COALNE", "DEPARE", "DEPCNT", "SOUNDG", "LIGHTS"],
    });
  });

  it("allows absent supported layers but rejects a present empty layer", () => {
    const missing = summaries();
    missing.delete("DEPCNT");
    missing.delete("LIGHTS");
    expect(parseMetadata(metadata(), missing).layers).toEqual(["COALNE", "DEPARE", "SOUNDG"]);
    expect(() => parseMetadata(metadata(), summaries({ SOUNDG: summary("SOUNDG", 0, [-87, 43, -86, 44]) }))).toThrow(
      "Required S-57 layer SOUNDG contains no features",
    );
    expect(() => parseMetadata(metadata(), summaries({ LIGHTS: summary("LIGHTS", 0, [-87, 43, -86, 44]) }))).toThrow(
      "Required S-57 layer LIGHTS contains no features",
    );
  });

  it("rejects absent metadata and non-metre depths", () => {
    expect(() => parseMetadata(metadata({ DSPM_CSCL: undefined }), summaries())).toThrow("DSPM_CSCL");
    expect(() => parseMetadata(metadata({ DSPM_DUNI: 2 }), summaries())).toThrow("schema v1 requires metres");
    expect(() => parseMetadata(metadata({ DSPM_HUNI: 2 }), summaries())).toThrow("light heightMetres requires metres");
  });

  it("identifies edition zero as a cancelled ENC cell", () => {
    expect(() => parseMetadata(metadata({ DSID_EDTN: "0" }), summaries()))
      .toThrow("ENC cell US4WI1DP is cancelled (edition 0)");
  });
});
