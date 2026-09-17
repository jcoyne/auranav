import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ChartPackageManifest } from "../chart-package";
import { addPackageChartLayers } from "./chart-layers";

describe("package chart layers", () => {
  it("adds cells lazily and hides previously selected cells", () => {
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
      on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const layers = addPackageChartLayers(map, manifest(), new URL("https://example.test/charts/manifest.json"));

    layers.showCells(["US4AAAAA"]);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "chart-coastline-0" }));

    layers.showCells(["US5BBBBB"]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-coastline-0", "visibility", "none");
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "chart-coastline-1" }));

    layers.showCells(["US4AAAAA"]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-coastline-0", "visibility", "visible");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-coastline-1", "visibility", "none");
    expect(map.addSource).toHaveBeenCalledTimes(2);
  });
});

function manifest(): ChartPackageManifest {
  const commonCell = {
    edition: 1,
    updateNumber: 0,
    issueDate: "2026-01-01",
    updateApplicationDate: "2026-01-01",
    compilationScale: 90_000,
  };
  return {
    schemaVersion: 1,
    packageId: "wisconsin",
    name: "Wisconsin",
    generatedAt: "2026-09-17T12:00:00Z",
    source: {
      publisher: "NOAA Office of Coast Survey",
      product: "NOAA ENC",
      downloadUrl: "https://charts.noaa.gov/ENCs/WI_ENCs.zip",
      retrievedAt: "2026-09-17T12:00:00Z",
      userAgreementPath: "./USER_AGREEMENT.txt",
    },
    bounds: [-90, 42, -86, 45],
    depth: { storedUnit: "metre", displayUnit: "foot", verticalDatums: ["test datum"] },
    tileSets: [
      { id: "first", cellName: "US4AAAAA", format: "pmtiles", url: "./first.pmtiles", minZoom: 0, maxZoom: 16, layers: ["coastline"] },
      { id: "second", cellName: "US5BBBBB", format: "pmtiles", url: "./second.pmtiles", minZoom: 0, maxZoom: 16, layers: ["coastline"] },
    ],
    cells: [
      { ...commonCell, name: "US4AAAAA", usageBand: 4, bounds: [-90, 42, -87, 45] },
      { ...commonCell, name: "US5BBBBB", usageBand: 5, bounds: [-88, 42, -86, 44] },
    ],
  };
}
