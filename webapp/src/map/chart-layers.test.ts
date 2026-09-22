import { describe, expect, it, vi } from "vitest";
import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { createExpression, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { ChartPackageManifest } from "../chart-package";
import { TILE_LAYERS } from "../chart-package";
import { addDemoChartLayers, addPackageChartLayers, contourLabelExpression } from "./chart-layers";
import { landLabelFilter } from "./land";
import { ANCHORING_PROHIBITED_PATTERN_ID, landmarkImageId } from "./chart-symbols";
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

  it("draws docks, piers and moorings, one layer per geometry primitive", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["coastline", "shoreline-structure", "mooring"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    // A pier is charted as an area in one cell and a line in another, and
    // `SLCONS` also carries points, so each primitive is filtered out on its own:
    // a fill over a line, or a line over a point, draws nothing or misdraws.
    const expected: Readonly<Record<string, readonly [string, string, string]>> = {
      "chart-shoreline-structure-fill-0": ["shoreline-structure", "fill", "Polygon"],
      "chart-shoreline-structure-edge-0": ["shoreline-structure", "line", "Polygon"],
      "chart-shoreline-structure-ruin-edge-0": ["shoreline-structure", "line", "Polygon"],
      "chart-shoreline-structure-line-0": ["shoreline-structure", "line", "LineString"],
      "chart-shoreline-structure-ruin-line-0": ["shoreline-structure", "line", "LineString"],
      "chart-shoreline-structure-point-0": ["shoreline-structure", "circle", "Point"],
      "chart-shoreline-structure-hit-line-0": ["shoreline-structure", "line", "LineString"],
      "chart-shoreline-structure-hit-point-0": ["shoreline-structure", "circle", "Point"],
      "chart-mooring-fill-0": ["mooring", "fill", "Polygon"],
      "chart-mooring-line-0": ["mooring", "line", "LineString"],
      "chart-mooring-ruin-line-0": ["mooring", "line", "LineString"],
      "chart-mooring-point-0": ["mooring", "circle", "Point"],
      "chart-mooring-hit-line-0": ["mooring", "line", "LineString"],
      "chart-mooring-hit-point-0": ["mooring", "circle", "Point"],
    };
    for (const [layerId, [sourceLayer, type, geometryType]] of Object.entries(expected)) {
      const layer = layers.get(layerId);
      expect(layer, `${layerId} was not added`).toBeDefined();
      expect(layer?.["source-layer"]).toBe(sourceLayer);
      expect(layer?.type).toBe(type);
      expect(JSON.stringify(layer?.filter)).toContain(`["geometry-type"],"${geometryType}"`);
    }

    // One map-level click handler still answers for all of them.
    for (const layerId of Object.keys(expected)) {
      expect(map.on).not.toHaveBeenCalledWith("click", layerId, expect.any(Function));
    }
    expect(map.on).toHaveBeenCalledWith("mouseenter", "chart-shoreline-structure-hit-point-0", expect.any(Function));
  });

  it("keeps shoreline armouring from burying the piers a vessel can tie to", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["shoreline-structure"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    const fill = layers.get("chart-shoreline-structure-fill-0");
    const edge = layers.get("chart-shoreline-structure-edge-0");
    const line = layers.get("chart-shoreline-structure-line-0");
    // `CATSLC` 4 is a pier, 8 rip rap and 10 a sea wall.
    const pier = { category: "4" };
    const ripRap = { category: "8" };
    const seaWall = { category: "10" };

    // A berthing structure is drawn solid in the ink of the coastline; armouring
    // is a subdued grey, narrower, and does not appear at all until the zoom
    // where the coastline itself is drawn in detail.
    expect(paint(fill, "fill-color", pier)).not.toEqual(paint(fill, "fill-color", ripRap));
    expect(paint(fill, "fill-color", ripRap)).toEqual(paint(fill, "fill-color", seaWall));
    expect(paint(fill, "fill-opacity", ripRap, 12)).toBe(0);
    expect(paint(fill, "fill-opacity", pier, 12)).toBe(1);
    expect(paint(fill, "fill-opacity", ripRap, 14)).toBeLessThan(1);
    expect(paint(fill, "fill-opacity", pier, 14)).toBe(1);
    for (const armoured of [edge, line]) {
      expect(paint(armoured, "line-color", pier)).not.toEqual(paint(armoured, "line-color", ripRap));
      expect(paint(armoured, "line-width", ripRap))
        .toBeLessThan(paint(armoured, "line-width", pier) as number);
      expect(paint(armoured, "line-opacity", ripRap, 12)).toBe(0);
      expect(paint(armoured, "line-opacity", pier, 12)).toBe(1);
    }
    // The pier itself is not held back: it is drawn from the structure zoom on.
    expect(fill?.minzoom).toBeLessThan(13);
  });

  it("tells a ruined structure apart from one a vessel can still use", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["shoreline-structure", "mooring"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    const pier = { category: "4" };
    const ruinedPier = { category: "4", condition: "2" };
    const fill = layers.get("chart-shoreline-structure-fill-0");
    const point = layers.get("chart-shoreline-structure-point-0");

    // Colour: a ruin is grey, never the built tan or the ink of a live structure.
    expect(paint(fill, "fill-color", ruinedPier)).not.toEqual(paint(fill, "fill-color", pier));
    expect(paint(point, "circle-color", ruinedPier)).not.toEqual(paint(point, "circle-color", pier));

    // `line-dasharray` takes no per-feature value, so a ruin is drawn broken by
    // layers of its own, filtered on `CONDTN` 2 against the solid layers.
    const ruinedFilter = JSON.stringify(["in", ",2,", ["concat", ",", ["to-string", ["get", "condition"]], ","]]);
    for (const prefix of ["chart-shoreline-structure", "chart-mooring"]) {
      const solid = layers.get(`${prefix}-line-0`);
      const ruin = layers.get(`${prefix}-ruin-line-0`);
      expect(solid?.paint?.["line-dasharray"]).toBeUndefined();
      expect(ruin?.paint?.["line-dasharray"]).toEqual([2, 2]);
      expect(JSON.stringify(ruin?.filter)).toContain(ruinedFilter);
      expect(JSON.stringify(solid?.filter)).toContain(`["!",${ruinedFilter}]`);
    }
    const ruinEdge = layers.get("chart-shoreline-structure-ruin-edge-0");
    expect(ruinEdge?.paint?.["line-dasharray"]).toEqual([2, 2]);

    // And the ruin is named on the chart, so it reads without opening a popup.
    for (const prefix of ["chart-shoreline-structure", "chart-mooring"]) {
      const label = layers.get(`${prefix}-ruin-label-0`);
      expect(label?.type).toBe("symbol");
      expect(label?.layout?.["text-field"]).toBe("Ruin");
      expect(label?.layout?.["text-font"]).toEqual(["Noto Sans Regular"]);
      expect(JSON.stringify(label?.filter)).toBe(ruinedFilter);
    }
  });

  it("draws structures with the shore, under every aid and hazard", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = [...TILE_LAYERS];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const order = layerOrder(map);
    const position = (layerId: string): number => {
      const index = order.indexOf(layerId);
      expect(index, `${layerId} was not added`).toBeGreaterThanOrEqual(0);
      return index;
    };
    // A pier is built on the shore, so it draws over the land and the coastline.
    for (const geometry of ["chart-land-area-0", "chart-coastline-0"]) {
      expect(position(geometry)).toBeLessThan(position("chart-shoreline-structure-fill-0"));
      expect(position(geometry)).toBeLessThan(position("chart-mooring-fill-0"));
    }
    // Aids and hazards keep their collision priority over the ruin labels.
    for (const aid of ["chart-buoy-symbol-0", "chart-danger-symbol-0"]) {
      for (const label of ["chart-shoreline-structure-ruin-label-0", "chart-mooring-ruin-label-0"]) {
        expect(position(aid)).toBeLessThan(position(label));
      }
    }
    // A structure is geometry, so it is drawn beneath the aids over it.
    for (const structure of ["chart-shoreline-structure-point-0", "chart-mooring-point-0"]) {
      expect(position(structure)).toBeLessThan(position("chart-buoy-symbol-0"));
    }
  });

  it("draws landmarks from both primitives, keyed off function and not category", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["landmark"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    // `LNDMRK` is charted as points and as areas — US5MKEDC and US5WI34A carry
    // polygons — so a fill cannot be left to draw a point, nor a circle an area.
    const expected: Readonly<Record<string, readonly [string, string, readonly string[]]>> = {
      "chart-landmark-fill-0": ["landmark", "fill", ["Polygon"]],
      "chart-landmark-edge-0": ["landmark", "line", ["Polygon"]],
      "chart-landmark-hit-0": ["landmark", "circle", ["Point"]],
      "chart-landmark-symbol-0": ["landmark", "symbol", ["Point", "Polygon"]],
      "chart-landmark-label-0": ["landmark", "symbol", ["Point", "Polygon"]],
    };
    for (const [layerId, [sourceLayer, type, geometryTypes]] of Object.entries(expected)) {
      const layer = layers.get(layerId);
      expect(layer, `${layerId} was not added`).toBeDefined();
      expect(layer?.["source-layer"]).toBe(sourceLayer);
      expect(layer?.type).toBe(type);
      for (const geometryType of ["Point", "LineString", "Polygon"] as const) {
        expect(matches(layer, geometryType, {}), `${layerId} on ${geometryType}`)
          .toBe(geometryTypes.includes(geometryType));
      }
    }

    // Every landmark outline is registered, and the mark is picked by FUNCTN 33
    // first: NOAA charts light supports whose CATLMK is a chimney or a dome, so
    // keying the lighthouse off category 17 would miss real ones.
    for (const shape of ["tower", "mast", "chimney", "spire", "dome", "mark", "light-support"]) {
      expect(map.addImage).toHaveBeenCalledWith(
        landmarkImageId(shape as Parameters<typeof landmarkImageId>[0]),
        expect.objectContaining({ data: expect.any(Uint8Array) }),
        expect.objectContaining({ pixelRatio: expect.any(Number) }),
      );
    }
    const symbol = layers.get("chart-landmark-symbol-0");
    const icon = (properties: Record<string, unknown>): unknown =>
      layout(symbol, "icon-image", properties);
    expect(icon({ category: "17", function: "33" })).toBe(landmarkImageId("light-support"));
    expect(icon({ category: "3", function: "30,33" })).toBe(landmarkImageId("light-support"));
    expect(icon({ category: "15", function: "33" })).toBe(landmarkImageId("light-support"));
    // Not every landmark is a lighthouse: 40 masts, 17 chimneys, 7 spires and
    // 4 domes in this region take the structure their category names.
    expect(icon({ category: "17" })).toBe(landmarkImageId("tower"));
    expect(icon({ category: "7", function: "31" })).toBe(landmarkImageId("mast"));
    expect(icon({ category: "3" })).toBe(landmarkImageId("chimney"));
    expect(icon({ category: "20" })).toBe(landmarkImageId("spire"));
    expect(icon({ category: "15" })).toBe(landmarkImageId("dome"));
    // A cairn, a monument or an undocumented category claims no shape at all.
    expect(icon({ category: "9" })).toBe(landmarkImageId("mark"));
    expect(icon({ category: "21" })).toBe(landmarkImageId("mark"));
    expect(icon({})).toBe(landmarkImageId("mark"));

    // The lighthouse structure is inked in the magenta of the light's own
    // label, so the tower, the flare and the label read as one object.
    const label = layers.get("chart-landmark-label-0");
    const edge = layers.get("chart-landmark-edge-0");
    const lightSupport = { function: "33" };
    const ordinary = { function: "31" };
    expect(paint(label, "text-color", lightSupport)).toBe("#b00078");
    expect(paint(label, "text-color", lightSupport))
      .not.toEqual(paint(label, "text-color", ordinary));
    expect(paint(edge, "line-color", lightSupport))
      .not.toEqual(paint(edge, "line-color", ordinary));

    // One map-level click handler still answers for all of them.
    for (const layerId of Object.keys(expected)) {
      expect(map.on).not.toHaveBeenCalledWith("click", layerId, expect.any(Function));
    }
    expect(map.on).toHaveBeenCalledWith("mouseenter", "chart-landmark-hit-0", expect.any(Function));
  });

  it("gives a landmark you can take a bearing on more weight than an ordinary one", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["landmark"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    const symbol = layers.get("chart-landmark-symbol-0");
    const label = layers.get("chart-landmark-label-0");
    const conspicuous = { category: "17", conspicuous: 1 };
    const ordinary = { category: "7", conspicuous: 2 };
    const unstated = { category: "7" };

    // CONVIS 1 is a mark a mariner can take a bearing on, so it is drawn larger
    // and named larger. CONVIS 2, and an absent CONVIS, are not.
    expect(layout(symbol, "icon-size", conspicuous))
      .toBeGreaterThan(layout(symbol, "icon-size", ordinary) as number);
    expect(layout(symbol, "icon-size", unstated)).toEqual(layout(symbol, "icon-size", ordinary));
    expect(layout(label, "text-size", conspicuous))
      .toBeGreaterThan(layout(label, "text-size", ordinary) as number);
    expect(paint(label, "text-color", conspicuous))
      .not.toEqual(paint(label, "text-color", ordinary));

    // And it appears earlier: the region holds 161 landmarks, most of them
    // masts and chimneys, and drawing those from the same zoom buries the
    // lighthouses among them. A light support counts as a bearing mark too,
    // whether or not the cell called it conspicuous.
    for (const [properties, drawnEarly] of [
      [conspicuous, true],
      [{ category: "17", function: "30,33" }, true],
      [ordinary, false],
      [unstated, false],
    ] as const) {
      expect(paint(symbol, "icon-opacity", properties, 11)).toBe(drawnEarly ? 1 : 0);
      expect(paint(symbol, "icon-opacity", properties, 14)).toBe(1);
      expect(paint(label, "text-opacity", properties, 12)).toBe(drawnEarly ? 1 : 0);
      expect(paint(label, "text-opacity", properties, 14)).toBe(1);
    }
    expect(symbol?.minzoom).toBe(10);
  });

  it("composes a lighthouse tower with its light flare instead of stacking two aids", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = [...TILE_LAYERS];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    const tower = layers.get("chart-landmark-symbol-0");
    const flare = layers.get("chart-light-symbol-0");
    // A lighthouse's LIGHTS point and its LNDMRK point are at the identical
    // coordinate, so the two marks cannot be separated by collision priority.
    // They are composed: the flare's tip is anchored on the charted position
    // and sweeps up and right, and the tower stands on that same position.
    expect(flare?.layout?.["icon-anchor"]).toBe("bottom-left");
    expect(tower?.layout?.["icon-anchor"]).toBe("bottom");

    // Neither may suppress the other. The flare allows overlap and ignores
    // placement, so nothing can drop it and it blocks nothing; the tower allows
    // overlap so the flare cannot drop it either. The tower does not ignore
    // placement, so it still outranks the labels placed after it.
    expect(flare?.layout?.["icon-allow-overlap"]).toBe(true);
    expect(flare?.layout?.["icon-ignore-placement"]).toBe(true);
    expect(tower?.layout?.["icon-allow-overlap"]).toBe(true);
    expect(tower?.layout?.["icon-ignore-placement"]).toBeUndefined();

    const order = layerOrder(map);
    const position = (layerId: string): number => {
      const index = order.indexOf(layerId);
      expect(index, `${layerId} was not added`).toBeGreaterThanOrEqual(0);
      return index;
    };
    // The tower is drawn after the flare, so its silhouette survives whole
    // where the two overlap at their shared origin.
    expect(position("chart-light-symbol-0")).toBeLessThan(position("chart-landmark-symbol-0"));
    // Aids and hazards still outrank the landmark mark, and the landmark mark
    // still outranks every label, its own included.
    for (const aid of ["chart-buoy-symbol-0", "chart-danger-symbol-0", "chart-light-symbol-0"]) {
      expect(position(aid)).toBeLessThan(position("chart-landmark-symbol-0"));
    }
    for (const label of [
      "chart-depth-contour-label-0", "chart-sounding-label-0", "chart-light-label-0",
      "chart-buoy-label-0", "chart-danger-label-0", "chart-landmark-label-0",
      "chart-harbour-facility-label-0", "chart-anchorage-label-0",
      "chart-restricted-area-label-0", "chart-water-label-0", "chart-land-label-0",
    ]) {
      expect(position("chart-landmark-symbol-0")).toBeLessThan(position(label));
    }
    // A landmark footprint is built ground: it draws with the shore, under aids.
    expect(position("chart-coastline-0")).toBeLessThan(position("chart-landmark-fill-0"));
    expect(position("chart-landmark-fill-0")).toBeLessThan(position("chart-buoy-symbol-0"));
  });

  it("outlines a restricted area only where a restriction applies to a vessel", () => {
    const map = chartMap();
    const chartManifest = manifest();
    chartManifest.tileSets[0]!.layers = ["restricted-area", "restricted-area-edge"];

    addPackageChartLayers(map, chartManifest, new URL("https://example.test/charts/manifest.json"))
      .showCells(["US4AAAAA"]);

    const layers = styleLayers(map);
    const edge = layers.get("chart-restricted-area-edge-0");
    // The cable areas, the Wisconsin Shipwreck Coast sanctuary and a security
    // zone all carry a RESTRN, and keep their outline.
    for (const restriction of ["2,6,24", "22,2,10", "8"]) {
      expect(matches(edge, "LineString", { restriction }), restriction).toBe(true);
    }
    // The Apostle Islands National Lakeshore is CATREA 23 with no RESTRN at
    // all. Its boundary is a long line that reads as a depth contour, so it is
    // labelled and left unoutlined. An empty string is absent too: a vector
    // tile omits a missing property, but a producer may write one instead.
    expect(matches(edge, "LineString", { category: "23" })).toBe(false);
    expect(matches(edge, "LineString", { restriction: "" })).toBe(false);
    expect(matches(edge, "LineString", {})).toBe(false);
    // Not on `anchoring`, which is derived from RESTRN 1 and 2 alone: the
    // security zone has neither and must keep its line.
    expect(matches(edge, "LineString", { restriction: "8" })).toBe(true);

    // Outlines that do draw keep the three-way anchoring distinction.
    const distinct = (value: unknown): number => new Set([
      ["prohibited", "1"], ["restricted", "2"], [undefined, "8"],
    ].map(([anchoring]) => {
      const expression = createExpression(value, "edge");
      if (expression.result === "error") throw new Error(expression.value.join(", "));
      return expression.value.evaluate({ zoom: 12 }, {
        type: "LineString",
        properties: anchoring === undefined ? {} : { anchoring },
      });
    })).size;
    expect(distinct(edge?.paint?.["line-color"])).toBe(3);
    expect(distinct(edge?.paint?.["line-width"])).toBe(3);

    // Every restricted area keeps its label, the Lakeshore included.
    expect(layers.get("chart-restricted-area-label-0")?.filter).toBeUndefined();
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


/** A layer as the test reads it back, without narrowing the MapLibre union. */
type StyleLayer = {
  id: string;
  type?: string;
  minzoom?: number;
  "source-layer"?: string;
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

/** Every layer the style was given, by id. */
function styleLayers(map: MapLibreMap): Map<string, StyleLayer> {
  return new Map(vi.mocked(map.addLayer).mock.calls
    .map(([layer]) => [layer.id, layer as unknown as StyleLayer]));
}

/**
 * One paint property as MapLibre would evaluate it for a feature at a zoom.
 * Comparing the expressions themselves would only show that two styles differ in
 * text; evaluating them shows that a pier and a rip rap really draw differently.
 */
function paint(
  layer: StyleLayer | undefined,
  property: string,
  properties: Record<string, unknown>,
  zoom = 16,
): unknown {
  const value = layer?.paint?.[property];
  expect(value, `${layer?.id ?? "layer"} has no ${property}`).toBeDefined();
  const expression = createExpression(value, `${layer?.id ?? ""}.paint.${property}`);
  if (expression.result === "error") throw new Error(expression.value.join(", "));
  return expression.value.evaluate({ zoom }, { type: "Polygon", properties });
}

/** One layout property as MapLibre would evaluate it for a feature at a zoom. */
function layout(
  layer: StyleLayer | undefined,
  property: string,
  properties: Record<string, unknown>,
  zoom = 16,
): unknown {
  const value = layer?.layout?.[property];
  expect(value, `${layer?.id ?? "layer"} has no ${property}`).toBeDefined();
  const expression = createExpression(value, `${layer?.id ?? ""}.layout.${property}`);
  if (expression.result === "error") throw new Error(expression.value.join(", "));
  return expression.value.evaluate({ zoom }, { type: "Point", properties });
}

/** The geometry types a chart source layer can carry. */
type GeometryType = "Point" | "LineString" | "Polygon";

/** Whether a layer's filter admits a feature of the given geometry type. */
function matches(
  layer: StyleLayer | undefined,
  geometryType: GeometryType,
  properties: Record<string, unknown>,
  zoom = 16,
): boolean {
  const filter = layer?.filter;
  if (filter === undefined) return true;
  const expression = createExpression(filter, `${layer?.id ?? ""}.filter`);
  if (expression.result === "error") throw new Error(expression.value.join(", "));
  return expression.value.evaluate({ zoom }, { type: geometryType, properties }) === true;
}

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

  it("routes the demo sounding through the shared dispatcher, not its own popup", () => {
    const map = chartMap();
    const registered: string[] = [];
    const dispatcher = {
      register: (interaction: { layerId: string }) => registered.push(interaction.layerId),
      closePopup: vi.fn(),
    };

    addDemoChartLayers(map, dispatcher);

    // Demo mode must not reintroduce the stacked-popup bug: a user mark dropped
    // on a demo sounding has to resolve to one popup, which only the shared
    // dispatcher can decide.
    expect(registered).toEqual(["sounding-point"]);
    expect(map.on).not.toHaveBeenCalledWith("click", "sounding-point", expect.any(Function));
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
