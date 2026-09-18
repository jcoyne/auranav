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
      moveLayer: vi.fn(),
      getLayer: vi.fn(),
      isSourceLoaded: vi.fn(() => true),
      on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const layers = addPackageChartLayers(map, manifest(), new URL("https://example.test/charts/manifest.json"));

    layers.showCells(["US4AAAAA"]);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "chart-coastline-0" }), undefined);

    layers.showCells(["US5BBBBB"]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-coastline-0", "visibility", "none");
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "chart-coastline-1" }), undefined);

    layers.showCells(["US4AAAAA"]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-coastline-0", "visibility", "visible");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-coastline-1", "visibility", "none");
    expect(map.addSource).toHaveBeenCalledTimes(2);
  });

  it("places each coverage mask before its chart content and keeps charts below GPS", () => {
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
      moveLayer: vi.fn(),
      getLayer: vi.fn((id: string) => id === "position-accuracy" ? {} : undefined),
      getCenter: vi.fn(() => ({ lng: -87.9, lat: 43 })),
      project: vi.fn(() => ({ x: 100, y: 100 })),
      queryRenderedFeatures: vi.fn(() => [{ layer: { id: "chart-coverage-mask-1" } }]),
      isSourceLoaded: vi.fn(() => true),
      on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets = chartManifest.tileSets.map((tileSet) => ({
      ...tileSet,
      layers: ["coverage", ...tileSet.layers],
    }));
    const layers = addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"));

    layers.showCells(["US4AAAAA", "US5BBBBB"]);

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-coverage-mask-0",
      "source-layer": "coverage",
      paint: expect.objectContaining({ "fill-opacity": 1 }),
    }), "position-accuracy");
    const moved = vi.mocked(map.moveLayer).mock.calls.map(([id, before]) => [id, before]);
    expect(moved).toEqual([
      ["chart-coverage-mask-0", "position-accuracy"],
      ["chart-coastline-0", "position-accuracy"],
      ["chart-coverage-mask-1", "position-accuracy"],
      ["chart-coastline-1", "position-accuracy"],
    ]);
    expect(layers.coverageCellNamesAtCenter()).toEqual(["US5BBBBB"]);
  });

  it("defers exact coverage status until every visible mask source is loaded", () => {
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
      moveLayer: vi.fn(),
      getLayer: vi.fn(),
      getCenter: vi.fn(() => ({ lng: -87.9, lat: 43 })),
      project: vi.fn(() => ({ x: 100, y: 100 })),
      queryRenderedFeatures: vi.fn(() => []),
      isSourceLoaded: vi.fn(() => false),
      on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets = chartManifest.tileSets.map((tileSet) => ({
      ...tileSet,
      layers: ["coverage", ...tileSet.layers],
    }));
    const layers = addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"));

    layers.showCells(["US4AAAAA"]);

    expect(layers.coverageCellNamesAtCenter()).toBeUndefined();
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
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
