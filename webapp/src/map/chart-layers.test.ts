import { describe, expect, it, vi } from "vitest";
import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { ChartPackageManifest } from "../chart-package";
import { TILE_LAYERS } from "../chart-package";
import { addPackageChartLayers, contourLabelExpression } from "./chart-layers";
import { landLabelFilter } from "./land";
import { ANCHORING_PROHIBITED_PATTERN_ID } from "./chart-symbols";
import { LIGHT_FLARE_PIXEL_RATIO, lightFlareIconExpression } from "./light-icon";

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
    expect(map.isSourceLoaded).toHaveBeenCalledWith("chart-0");
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it("checks the same source ID that was registered when queried immediately", () => {
    const registeredSourceIds = new Set<string>();
    const map = {
      addSource: vi.fn((sourceId: string) => registeredSourceIds.add(sourceId)),
      addLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
      moveLayer: vi.fn(),
      getLayer: vi.fn(),
      getCenter: vi.fn(() => ({ lng: -87.9, lat: 43 })),
      project: vi.fn(() => ({ x: 100, y: 100 })),
      queryRenderedFeatures: vi.fn(() => []),
      isSourceLoaded: vi.fn((sourceId: string) => {
        if (!registeredSourceIds.has(sourceId)) {
          throw new Error(`There is no tile manager with ID '${sourceId}'`);
        }
        return false;
      }),
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

    expect(() => layers.coverageCellNamesAtCenter()).not.toThrow();
    expect(map.addSource).toHaveBeenCalledWith("chart-0", expect.any(Object));
    expect(map.isSourceLoaded).toHaveBeenCalledWith("chart-0");
  });

  it("renders an optional navigation-light layer with a chart label and touch target", () => {
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), setLayoutProperty: vi.fn(), moveLayer: vi.fn(),
      getLayer: vi.fn(), isSourceLoaded: vi.fn(() => true), on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
      hasImage: vi.fn(() => false), addImage: vi.fn(),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["coastline", "light"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-light-hit-0",
      type: "circle",
      "source-layer": "light",
      paint: expect.objectContaining({ "circle-radius": 16 }),
    }), undefined);
    expect(map.addImage).toHaveBeenCalledWith(
      "light-flare-red",
      expect.objectContaining({ data: expect.any(Uint8Array) }),
      { pixelRatio: LIGHT_FLARE_PIXEL_RATIO },
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-light-symbol-0",
      type: "symbol",
      "source-layer": "light",
      layout: expect.objectContaining({
        "icon-image": lightFlareIconExpression(),
        "icon-anchor": "bottom-left",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      }),
    }), undefined);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-light-label-0",
      type: "symbol",
      "source-layer": "light",
      layout: expect.objectContaining({
        "text-variable-anchor": ["right", "top-right", "top", "top-left", "bottom-right", "left"],
        "text-radial-offset": 1,
        "text-allow-overlap": false,
      }),
    }), undefined);
    expect(map.on).toHaveBeenCalledWith("mouseenter", "chart-light-hit-0", expect.any(Function));
  });


  it("fills land areas under the coastline and labels them above the chart", () => {
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), setLayoutProperty: vi.fn(), moveLayer: vi.fn(),
      getLayer: vi.fn(), isSourceLoaded: vi.fn(() => true), on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["depth-area", "land-area", "coastline", "land-label"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-land-area-0",
      type: "fill",
      "source-layer": "land-area",
      paint: expect.objectContaining({ "fill-opacity": 1 }),
    }), undefined);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-land-label-0",
      type: "symbol",
      "source-layer": "land-label",
      filter: landLabelFilter(),
      layout: expect.objectContaining({ "text-field": ["get", "name"] }),
    }), undefined);

    const order = vi.mocked(map.addLayer).mock.calls.map(([layer]) => layer.id);
    expect(order).toEqual([
      "chart-depth-area-0", "chart-land-area-0", "chart-coastline-0", "chart-land-label-0",
    ]);
  });


  it("labels landforms from the finest visible band only", () => {
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), setLayoutProperty: vi.fn(), moveLayer: vi.fn(),
      getLayer: vi.fn(), isSourceLoaded: vi.fn(() => true), on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets = chartManifest.tileSets.map((tileSet) => ({
      ...tileSet,
      layers: ["land-area", "land-label"],
    }));

    // Band 4 is the coarse fallback kept beneath the selected band 5.
    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA", "US5BBBBB"]);

    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-land-label-0", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-land-area-0", "visibility", "visible");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-land-label-1", "visibility", "visible");
  });


  it("labels depth contours along the line in the package display unit", () => {
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), setLayoutProperty: vi.fn(), moveLayer: vi.fn(),
      getLayer: vi.fn(), isSourceLoaded: vi.fn(() => true), on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["depth-contour", "sounding"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-depth-contour-label-0",
      type: "symbol",
      "source-layer": "depth-contour",
      layout: expect.objectContaining({
        "symbol-placement": "line",
        "text-field": contourLabelExpression("foot"),
      }),
    }), undefined);

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-depth-contour-label-0",
      filter: [">", ["to-number", ["get", "depth"]], 0],
    }), undefined);

    // Contour labels are placed before soundings, so they win the collision.
    const order = vi.mocked(map.addLayer).mock.calls.map(([layer]) => layer.id);
    expect(order.indexOf("chart-depth-contour-label-0"))
      .toBeLessThan(order.indexOf("chart-sounding-label-0"));
  });

  it("adds every source layer the package declares, against its own source layer", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = [...TILE_LAYERS];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const sourceLayers = new Map(vi.mocked(map.addLayer).mock.calls
      .map(([layer]) => [layer.id, "source-layer" in layer ? layer["source-layer"] : undefined]));
    expect(Object.fromEntries([
      "chart-water-label-0",
      "chart-buoy-symbol-0",
      "chart-buoy-label-0",
      "chart-buoy-hit-0",
      "chart-danger-symbol-0",
      "chart-danger-label-0",
      "chart-danger-hit-0",
      "chart-harbour-facility-marker-0",
      "chart-harbour-facility-label-0",
      "chart-harbour-facility-hit-0",
      "chart-anchorage-fill-0",
      "chart-anchorage-outline-0",
      "chart-anchorage-label-0",
      "chart-restricted-area-fill-0",
      "chart-restricted-area-anchoring-0",
      "chart-restricted-area-edge-0",
      "chart-restricted-area-label-0",
      "chart-cable-0",
      "chart-cable-hit-0",
    ].map((layerId) => [layerId, sourceLayers.get(layerId)]))).toEqual({
      "chart-water-label-0": "water-label",
      "chart-buoy-symbol-0": "buoy",
      "chart-buoy-label-0": "buoy",
      "chart-buoy-hit-0": "buoy",
      "chart-danger-symbol-0": "danger",
      "chart-danger-label-0": "danger",
      "chart-danger-hit-0": "danger",
      "chart-harbour-facility-marker-0": "harbour-facility",
      "chart-harbour-facility-label-0": "harbour-facility",
      "chart-harbour-facility-hit-0": "harbour-facility",
      "chart-anchorage-fill-0": "anchorage",
      "chart-anchorage-outline-0": "anchorage",
      "chart-anchorage-label-0": "anchorage",
      "chart-restricted-area-fill-0": "restricted-area",
      "chart-restricted-area-anchoring-0": "restricted-area",
      "chart-restricted-area-edge-0": "restricted-area-edge",
      "chart-restricted-area-label-0": "restricted-area",
      "chart-cable-0": "cable",
      "chart-cable-hit-0": "cable",
    });
    // Popups come from one map-level handler, not one per layer: two layers
    // answering the same tap used to stack two popups over each other.
    for (const layerId of ["chart-buoy-hit-0", "chart-danger-hit-0", "chart-restricted-area-fill-0"]) {
      expect(map.on).toHaveBeenCalledWith("mouseenter", layerId, expect.any(Function));
      expect(map.on).not.toHaveBeenCalledWith("click", layerId, expect.any(Function));
    }
    expect(vi.mocked(map.on).mock.calls.filter(([type, arg]) => type === "click" && typeof arg === "function"))
      .toHaveLength(1);
  });

  it("adds a layer only for the source layers a tile set declares", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["coastline", "buoy"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    expect(layerOrder(map)).toEqual([
      "chart-coastline-0", "chart-buoy-hit-0", "chart-buoy-symbol-0", "chart-buoy-label-0",
    ]);
  });

  it("gives buoys and dangers collision priority over every label", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = [...TILE_LAYERS];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    // MapLibre places symbols in layer order, so an earlier symbol layer wins.
    const order = layerOrder(map);
    const position = (layerId: string): number => {
      const index = order.indexOf(layerId);
      expect(index, `${layerId} was not added`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const everyLabel = [
      "chart-depth-contour-label-0", "chart-sounding-label-0", "chart-light-label-0",
      "chart-buoy-label-0", "chart-danger-label-0", "chart-harbour-facility-label-0",
      "chart-anchorage-label-0", "chart-restricted-area-label-0",
      "chart-water-label-0", "chart-land-label-0",
    ];
    for (const aid of ["chart-buoy-symbol-0", "chart-danger-symbol-0"]) {
      for (const label of everyLabel) expect(position(aid)).toBeLessThan(position(label));
    }
    // Sounding and light labels outrank the names of landforms and water bodies.
    for (const depthOrLight of ["chart-sounding-label-0", "chart-light-label-0"]) {
      for (const placeName of ["chart-water-label-0", "chart-land-label-0"]) {
        expect(position(depthOrLight)).toBeLessThan(position(placeName));
      }
    }
    // Aids still draw above the chart geometry they sit on.
    for (const geometry of ["chart-depth-area-0", "chart-land-area-0", "chart-coastline-0"]) {
      expect(position(geometry)).toBeLessThan(position("chart-buoy-symbol-0"));
    }
    // An area wash belongs under the soundings and contours it shares water with.
    for (const area of ["chart-anchorage-fill-0", "chart-restricted-area-fill-0"]) {
      expect(position("chart-depth-area-0")).toBeLessThan(position(area));
      expect(position(area)).toBeLessThan(position("chart-depth-contour-0"));
    }
  });

  it("lifts restricted areas clear of the cells that would paint over them", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets = chartManifest.tileSets.map((tileSet) => ({
      ...tileSet,
      layers: ["coverage", "restricted-area"],
    }));

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA", "US5BBBBB"]);

    // A restricted area charted only by the coarse cell must end up above the
    // fine cell's opaque coverage, or it vanishes while still answering clicks.
    const moved = vi.mocked(map.moveLayer).mock.calls.map(([id]) => id);
    expect(moved.lastIndexOf("chart-restricted-area-fill-0"))
      .toBeGreaterThan(moved.lastIndexOf("chart-coverage-mask-1"));
    expect(moved.lastIndexOf("chart-restricted-area-label-0"))
      .toBeGreaterThan(moved.lastIndexOf("chart-coverage-mask-1"));
  });

  it("shows an anchoring restriction on the chart itself, without a popup", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["restricted-area", "restricted-area-edge"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    // Prohibited water is hatched, which no collision can suppress.
    expect(map.addImage).toHaveBeenCalledWith(
      ANCHORING_PROHIBITED_PATTERN_ID,
      expect.objectContaining({ data: expect.any(Uint8Array) }),
      expect.objectContaining({ pixelRatio: expect.any(Number) }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-restricted-area-anchoring-0",
      type: "fill",
      filter: ["==", ["to-string", ["get", "anchoring"]], "prohibited"],
      paint: { "fill-pattern": ANCHORING_PROHIBITED_PATTERN_ID },
    }), undefined);

    // Prohibited, restricted and unrestricted water each take their own edge and
    // label colour. The fill carries no wash: it would tint the chart under areas
    // as large as a national lakeshore, so it is only the click target.
    const layers = new Map(vi.mocked(map.addLayer).mock.calls
      .map(([layer]) => [layer.id, layer as unknown as StyleLayer] as const));
    const fill = layers.get("chart-restricted-area-fill-0");
    const outline = layers.get("chart-restricted-area-edge-0");
    const label = layers.get("chart-restricted-area-label-0");
    const distinct = (value: unknown): unknown[] => {
      expect(Array.isArray(value)).toBe(true);
      const match = value as unknown[];
      expect(match[0]).toBe("match");
      expect(match[1]).toEqual(["to-string", ["get", "anchoring"]]);
      expect(match[2]).toBe("prohibited");
      expect(match[4]).toBe("restricted");
      return [match[3], match[5], match[6]];
    };
    expect(fill?.paint?.["fill-color"]).toBe("rgba(0, 0, 0, 0)");
    expect(fill?.paint?.["fill-opacity"]).toBeUndefined();
    expect(new Set(distinct(outline?.paint?.["line-color"])).size).toBe(3);
    expect(new Set(distinct(outline?.paint?.["line-width"])).size).toBe(3);
    expect(new Set(distinct(label?.paint?.["text-color"])).size).toBe(3);

    // The rule is the label, so it reads without opening anything.
    const text = label?.layout?.["text-field"] as unknown[];
    expect(text[2]).toBe("Anchoring prohibited");
    expect(text[4]).toBe("Anchoring restricted");
  });

  it("bands water labels by span exactly as landform labels are banded", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["water-label", "land-label"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    // Both layers carry `spanDegrees` with the same meaning, so both use the band.
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: "chart-water-label-0",
      "source-layer": "water-label",
      filter: landLabelFilter(),
      layout: expect.objectContaining({ "text-field": ["get", "name"], "text-transform": "uppercase" }),
    }), undefined);
  });

  it("sets settlement names apart from the landforms they stand on", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["land-label"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const landLabel = vi.mocked(map.addLayer).mock.calls[0]?.[0] as unknown as StyleLayer;
    const settlementSize = landLabel?.layout?.["text-size"] as unknown[];
    const settlementColor = landLabel?.paint?.["text-color"] as unknown[];
    // `match` on kind: settlement first, physical landform as the default.
    expect(settlementSize[1]).toEqual(["to-string", ["get", "kind"]]);
    expect(settlementSize[2]).toBe("settlement");
    expect(settlementSize[3]).not.toBe(settlementSize[4]);
    expect(settlementColor[3]).not.toBe(settlementColor[4]);
  });

  it("names water bodies from the finest band, and keeps every band's facilities", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets = chartManifest.tileSets.map((tileSet) => ({
      ...tileSet,
      layers: ["water-label", "land-label", "harbour-facility"],
    }));

    // Band 4 is the coarse fallback kept beneath the selected band 5.
    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA", "US5BBBBB"]);

    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-water-label-0", "visibility", "none");
    expect(map.setLayoutProperty).toHaveBeenCalledWith("chart-water-label-1", "visibility", "visible");
    // A harbour facility is charted in one band only, so the coarse band must
    // keep drawing it: Port Superior Village Marina is in the band 4 cell alone.
    expect(map.setLayoutProperty)
      .toHaveBeenCalledWith("chart-harbour-facility-marker-0", "visibility", "visible");
    expect(map.setLayoutProperty)
      .toHaveBeenCalledWith("chart-harbour-facility-label-0", "visibility", "visible");
  });

  it("produces layer specifications MapLibre accepts", () => {
    const map = {
      addSource: vi.fn(), addLayer: vi.fn(), setLayoutProperty: vi.fn(), moveLayer: vi.fn(),
      getLayer: vi.fn(), isSourceLoaded: vi.fn(() => true), on: vi.fn(),
      getCanvas: vi.fn(() => document.createElement("canvas")),
      hasImage: vi.fn(() => false), addImage: vi.fn(),
    } as unknown as MapLibreMap;
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = [...TILE_LAYERS];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const errors = validateStyleMin({
      version: 8,
      glyphs: "https://example.test/fonts/{fontstack}/{range}.pbf",
      sources: { "chart-0": { type: "vector", tiles: ["https://example.test/{z}/{x}/{y}.pbf"] } },
      // `addLayer` widens each layer's `source` to accept an inline source specification.
      layers: vi.mocked(map.addLayer).mock.calls.map(([layer]) => layer) as LayerSpecification[],
    });
    expect(errors.map((error) => `${error.line ?? ""} ${error.message}`)).toEqual([]);
  });
});

/** A layer as the test reads it back, without narrowing the MapLibre union. */
type StyleLayer = {
  id: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

/** A map double that records what the style would be given. */
function chartMap(): MapLibreMap {
  return {
    addSource: vi.fn(), addLayer: vi.fn(), setLayoutProperty: vi.fn(), moveLayer: vi.fn(),
    getLayer: vi.fn(), isSourceLoaded: vi.fn(() => true), on: vi.fn(),
    getCanvas: vi.fn(() => document.createElement("canvas")),
    hasImage: vi.fn(() => false), addImage: vi.fn(),
  } as unknown as MapLibreMap;
}

/** The layers added, in the order they were added, which is the order they draw. */
function layerOrder(map: MapLibreMap): string[] {
  return vi.mocked(map.addLayer).mock.calls.map(([layer]) => layer.id);
}

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
