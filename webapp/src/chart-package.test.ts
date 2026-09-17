import { describe, expect, it } from "vitest";
import { ManifestError, parseChartPackageManifest } from "./chart-package";

const validManifest = {
  schemaVersion: 1,
  packageId: "wisconsin-demo",
  name: "Wisconsin ENC",
  generatedAt: "2026-09-17T16:00:00Z",
  source: {
    publisher: "NOAA Office of Coast Survey",
    product: "NOAA ENC",
    downloadUrl: "https://charts.noaa.gov/ENCs/WI_ENCs.zip",
    retrievedAt: "2026-09-17T15:30:00Z",
    userAgreementPath: "./USERAGREEMENT.txt",
  },
  bounds: [-88.15, 42.85, -87.65, 43.2],
  depth: { storedUnit: "metre", displayUnit: "foot", verticalDatums: ["Low Water Datum"] },
  tileSets: [{
    id: "demo",
    format: "pmtiles",
    url: "./wisconsin.pmtiles",
    minZoom: 6,
    maxZoom: 16,
    layers: ["coastline", "depth-area", "depth-contour", "sounding"],
  }],
  cells: [{
    name: "US4WI1DP",
    edition: 1,
    updateNumber: 4,
    issueDate: "2025-12-08",
    updateApplicationDate: "2026-09-16",
    usageBand: 4,
    compilationScale: 45_000,
    verticalDatum: "Low Water Datum",
    bounds: [-88.15, 42.85, -87.65, 43.2],
  }],
};

describe("parseChartPackageManifest", () => {
  it("returns the schema-v1 fields consumed by the viewer", () => {
    expect(parseChartPackageManifest(validManifest)).toMatchObject({
      schemaVersion: 1,
      name: "Wisconsin ENC",
      depth: { displayUnit: "foot" },
      tileSets: [{ format: "pmtiles", layers: ["coastline", "depth-area", "depth-contour", "sounding"] }],
      cells: [{ edition: 1, updateNumber: 4 }],
    });
  });

  it.each([
    ["unknown schema version", { ...validManifest, schemaVersion: 2 }],
    ["reversed bounds", { ...validManifest, bounds: [-87.65, 42.85, -88.15, 43.2] }],
    ["invalid zoom range", {
      ...validManifest,
      tileSets: [{ ...validManifest.tileSets[0], minZoom: 17, maxZoom: 16 }],
    }],
    ["unknown source layer", {
      ...validManifest,
      tileSets: [{ ...validManifest.tileSets[0], layers: ["wreck"] }],
    }],
    ["missing cells", { ...validManifest, cells: [] }],
  ])("rejects %s", (_label, candidate) => {
    expect(() => parseChartPackageManifest(candidate)).toThrow(ManifestError);
  });
});
