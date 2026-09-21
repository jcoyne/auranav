import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  coverageCommand,
  datasetSummaryCommand,
  extractionCommand,
  LAND_LABEL_EXTRACT,
  metadataCommand,
  parseLayerSummaries,
  parseMetadata,
  parseProducedLayers,
  spatialiteProbeCommand,
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

type SummaryLayer = "M_COVR" | "COALNE" | "DEPARE" | "DEPCNT" | "SOUNDG" | "LIGHTS" | "LNDARE" | "LNDRGN";

function summaries(overrides: Partial<Record<SummaryLayer, object>> = {}) {
  return new Map([
    ["M_COVR" as const, JSON.stringify(overrides.M_COVR ?? coverageSummary())],
    ["COALNE" as const, JSON.stringify(overrides.COALNE ?? summary("COALNE", 27, [-87.9, 42.9, -87.6, 43.2]))],
    ["DEPARE" as const, JSON.stringify(overrides.DEPARE ?? summary("DEPARE", 33, [-87.85, 42.95, -87.65, 43.15]))],
    ["DEPCNT" as const, JSON.stringify(overrides.DEPCNT ?? summary("DEPCNT", 36, [-87.8, 43, -87.7, 43.1]))],
    ["SOUNDG" as const, JSON.stringify(overrides.SOUNDG ?? summary("SOUNDG", 335, [-87.82, 42.98, -87.68, 43.12]))],
    ["LIGHTS" as const, JSON.stringify(overrides.LIGHTS ?? summary("LIGHTS", 12, [-87.81, 42.99, -87.69, 43.11]))],
    ["LNDARE" as const, JSON.stringify(overrides.LNDARE ?? summary("LNDARE", 16, [-87.88, 42.92, -87.66, 43.18]))],
    ["LNDRGN" as const, JSON.stringify(overrides.LNDRGN ?? summary("LNDRGN", 5, [-87.87, 42.93, -87.67, 43.17]))],
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

function landLabelSpec(sources: readonly ("LNDARE" | "LNDRGN")[]) {
  return { ...LAND_LABEL_EXTRACT, sources };
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
      sources: ["SOUNDG"],
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
    }, parsed, true);

    expect(command.args).toContain("light");
    expect(command.args).toContain(
      "SELECT COLOUR AS color, LITCHR AS characteristic, SIGGRP AS signalGroup, SIGPER AS periodSeconds, HEIGHT AS heightMetres, VALNMR AS nominalRangeNm, SECTR1 AS sectorStart, SECTR2 AS sectorEnd, ORIENT AS orientation, VERDAT AS heightDatum, CATLIT AS category, STATUS AS status, 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale FROM LIGHTS",
    );
  });

  it("extracts only positive M_COVR polygons as stable coverage", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", {
      sources: ["M_COVR"],
      outputLayer: "coverage",
      properties: [],
      where: "CATCOV = 1",
    }, parsed, true);

    expect(command.args).toContain("coverage");
    expect(command.args).toContain("SELECT 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale FROM M_COVR WHERE CATCOV = 1");
  });

  it("extracts only polygon land areas so the fill layer has drawable geometry", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", {
      sources: ["LNDARE"],
      outputLayer: "land-area",
      properties: ["OBJNAM AS name"],
      where: "OGR_GEOMETRY = 'POLYGON'",
    }, parsed, false);

    expect(command.args).toContain("land-area");
    expect(command.args).toContain("OGRSQL");
    expect(command.args).toContain(
      "SELECT OBJNAM AS name, 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale FROM LNDARE WHERE OGR_GEOMETRY = 'POLYGON'",
    );
  });

  it("anchors one landform label per name across both land sources", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", landLabelSpec(["LNDARE", "LNDRGN"]), parsed, false);

    expect(command.args).toContain("land-label");
    expect(command.args).toContain("SQLITE");
    expect(command.args).toContain(
      "SELECT name, MAX(ST_MaxX(shape) - ST_MinX(shape), ST_MaxY(shape) - ST_MinY(shape), 0.005) AS spanDegrees, "
      + "ST_PointOnSurface(shape) AS geometry, 'US4WI1DP' AS cell, 4 AS usageBand, 90000 AS compilationScale "
      + "FROM (SELECT name, ST_Union(part) AS shape FROM ("
      + "SELECT OBJNAM AS name, geometry AS part FROM LNDARE WHERE OBJNAM IS NOT NULL UNION ALL "
      + "SELECT OBJNAM AS name, geometry AS part FROM LNDRGN WHERE OBJNAM IS NOT NULL) GROUP BY name)",
    );
  });

  it("labels from whichever land sources a cell actually contains", () => {
    const parsed = parseMetadata(metadata(), summaries()).cell;
    const command = extractionCommand(baseCell, "layers.gpkg", landLabelSpec(["LNDRGN"]), parsed, false);
    const sql = command.args[command.args.indexOf("-sql") + 1] ?? "";

    expect(sql).toContain("FROM LNDRGN WHERE OBJNAM IS NOT NULL) GROUP BY name)");
    expect(sql).not.toContain("LNDARE");
  });

  it("drops optional layers a cell filtered empty and rejects any other empty extract", () => {
    const staging = JSON.stringify({
      driverShortName: "GPKG",
      layers: [
        { name: "coverage", featureCount: 3 },
        { name: "land-area", featureCount: 12 },
        { name: "land-label", featureCount: 0 },
      ],
    });
    expect(parseProducedLayers(staging, [
      { name: "coverage", mayBeEmpty: false },
      { name: "land-area", mayBeEmpty: true },
      { name: "land-label", mayBeEmpty: true },
    ])).toEqual(["coverage", "land-area"]);
    expect(() => parseProducedLayers(staging, [{ name: "sounding", mayBeEmpty: false }]))
      .toThrow("Extracted layer sounding contains no features");
  });

  it("probes for the SpatiaLite functions landform labels depend on", () => {
    expect(spatialiteProbeCommand(baseCell).args).toEqual([
      "-ro", "-q", "-dialect", "SQLITE", "-sql",
      "SELECT ST_PointOnSurface(ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 0))')) AS geometry",
      baseCell,
    ]);
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
      layers: ["COALNE", "DEPARE", "DEPCNT", "SOUNDG", "LIGHTS", "LNDARE", "LNDRGN"],
    });
  });

  it("allows absent supported layers but rejects a present empty layer", () => {
    const missing = summaries();
    missing.delete("DEPCNT");
    missing.delete("LIGHTS");
    expect(parseMetadata(metadata(), missing).layers).toEqual(["COALNE", "DEPARE", "SOUNDG", "LNDARE", "LNDRGN"]);
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
