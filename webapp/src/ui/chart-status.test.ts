import { describe, expect, it } from "vitest";
import type { ChartPackageManifest } from "../chart-package";
import { renderPackageChartStatus } from "./chart-status";

const manifest: ChartPackageManifest = {
  schemaVersion: 1,
  packageId: "wisconsin-us4wi1dp",
  name: "NOAA ENC US4WI1DP",
  generatedAt: "2026-09-17T12:00:00Z",
  source: {
    publisher: "NOAA Office of Coast Survey",
    product: "NOAA ENC",
    downloadUrl: "https://charts.noaa.gov/ENCs/WI_ENCs.zip",
    retrievedAt: "2026-09-17T12:00:00Z",
    userAgreementPath: "./USER_AGREEMENT.txt",
  },
  bounds: [-87.9, 42.9, -87.6, 43.2],
  depth: {
    storedUnit: "metre",
    displayUnit: "foot",
    verticalDatums: ["International Great Lakes Datum 1985"],
  },
  tileSets: [{
    id: "us4wi1dp-chart",
    format: "pmtiles",
    url: "./wisconsin-us4wi1dp.pmtiles",
    minZoom: 6,
    maxZoom: 16,
    layers: ["coastline", "depth-area", "depth-contour", "sounding"],
  }],
  cells: [{
    name: "US4WI1DP",
    edition: 1,
    updateNumber: 4,
    issueDate: "2025-12-08",
    updateApplicationDate: "2023-12-21",
    usageBand: 4,
    compilationScale: 90_000,
    verticalDatum: "International Great Lakes Datum 1985",
    bounds: [-87.9, 42.9, -87.6, 43.2],
  }],
};

describe("renderPackageChartStatus", () => {
  it("shows chart provenance and resolves the NOAA agreement relative to the manifest", () => {
    const container = document.createElement("section");

    renderPackageChartStatus(container, manifest, new URL("https://example.test/charts/manifest.json"));

    expect(container.textContent).toContain("NOAA Office of Coast Survey · NOAA ENC");
    expect(container.textContent).toContain("US4WI1DP ed. 1, update 4");
    expect(container.textContent).toContain("2025-12-08");
    expect(container.textContent).toContain("feet (stored in metres)");
    expect(container.textContent).toContain("International Great Lakes Datum 1985");
    expect(container.textContent).toContain("1:90,000");
    expect(container.querySelector("a")?.href).toBe("https://example.test/charts/USER_AGREEMENT.txt");
  });
});
