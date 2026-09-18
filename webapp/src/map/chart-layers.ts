import type { ChartPackageManifest, DepthUnit, TileLayer } from "../chart-package";
import { resolvePackageAssetUrl } from "../chart-package-url";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { addProtocol, Popup } from "maplibre-gl";
import { PMTiles, Protocol } from "pmtiles";
import {
  demoCoastline,
  demoDepthAreas,
  demoDepthContours,
  demoSoundings,
} from "./demo-chart";
import { POSITION_ACCURACY_LAYER_ID, POSITION_FIX_LAYER_ID } from "./position-layer";

export const DEMO_SOURCE_IDS = {
  coastline: "demo-coastline",
  depthArea: "demo-depth-area",
  depthContour: "demo-depth-contour",
  sounding: "demo-sounding",
} as const;

const protocol = new Protocol();
let protocolRegistered = false;

export function addPackageChartLayers(
  map: MapLibreMap,
  manifest: ChartPackageManifest,
  manifestUrl: URL,
): {
  showCells(cellNames: readonly string[]): void;
  coverageCellNamesAtCenter(): string[] | undefined;
} {
  registerPmtilesProtocol();
  const added = new Map<number, string[]>();
  let visibleCellNames = new Set<string>();

  return {
    showCells(cellNames) {
      const visibleCells = new Set(cellNames);
      visibleCellNames = visibleCells;
      const beforeId = positionLayerId(map);
      manifest.tileSets.forEach((tileSet, index) => {
        if (tileSet.format !== "pmtiles") return;
        const existingLayerIds = added.get(index);
        if (existingLayerIds) {
          const visibility = visibleCells.has(tileSet.cellName) ? "visible" : "none";
          existingLayerIds.forEach((layerId) => map.setLayoutProperty(layerId, "visibility", visibility));
          return;
        }
        if (!visibleCells.has(tileSet.cellName)) return;

        const archiveUrl = resolvePackageAssetUrl(tileSet.url, manifestUrl).href;
        protocol.add(new PMTiles(archiveUrl));
        const sourceId = chartSourceId(index);
        map.addSource(sourceId, {
          type: "vector",
          url: `pmtiles://${archiveUrl}`,
          attribution: "NOAA Office of Coast Survey",
          minzoom: tileSet.minZoom,
          maxzoom: tileSet.maxZoom,
        });
        added.set(index, addVectorLayers(
          map,
          sourceId,
          index,
          tileSet.layers,
          manifest.depth.displayUnit,
          beforeId,
        ));
      });

      // `cellNames` is coarse-to-detailed. Reapply that order because cells are
      // loaded lazily and may have first appeared in a different view.
      cellNames.forEach((cellName) => {
        manifest.tileSets.forEach((tileSet, index) => {
          if (tileSet.cellName !== cellName) return;
          added.get(index)?.forEach((layerId) => map.moveLayer(layerId, beforeId));
        });
      });
    },
    coverageCellNamesAtCenter() {
      const layersToCells = new Map<string, string>();
      const cellsWithCoverage = new Set<string>();
      const visibleCoverageSources: string[] = [];
      manifest.tileSets.forEach((tileSet, index) => {
        if (!visibleCellNames.has(tileSet.cellName) || !tileSet.layers.includes("coverage")) return;
        const layerId = `chart-coverage-mask-${index}`;
        if (added.get(index)?.includes(layerId)) {
          layersToCells.set(layerId, tileSet.cellName);
          cellsWithCoverage.add(tileSet.cellName);
          visibleCoverageSources.push(chartSourceId(index));
        }
      });
      // Mixed old/new packages cannot provide complete exact coverage, so let
      // callers retain the bounds-based compatibility behavior.
      if ([...visibleCellNames].some((cellName) => !cellsWithCoverage.has(cellName))) return undefined;
      if (layersToCells.size === 0) return undefined;
      if (visibleCoverageSources.some((sourceId) => !map.isSourceLoaded(sourceId))) return undefined;

      const features = map.queryRenderedFeatures(map.project(map.getCenter()), {
        layers: [...layersToCells.keys()],
      });
      return [...new Set(features.flatMap((feature) => {
        const cellName = layersToCells.get(feature.layer.id);
        return cellName === undefined ? [] : [cellName];
      }))];
    },
  };
}

function chartSourceId(index: number): string {
  return `chart-${index}`;
}

function registerPmtilesProtocol(): void {
  if (protocolRegistered) return;
  addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

function addVectorLayers(
  map: MapLibreMap,
  sourceId: string,
  index: number,
  layers: TileLayer[],
  displayUnit: DepthUnit,
  beforeId?: string,
): string[] {
  const layerIds: string[] = [];
  if (layers.includes("coverage")) {
    const layerId = `chart-coverage-mask-${index}`;
    map.addLayer({
      id: layerId,
      type: "fill",
      source: sourceId,
      "source-layer": "coverage",
      paint: {
        "fill-color": "#d8f3f5",
        "fill-opacity": 1,
        "fill-antialias": false,
      },
    }, beforeId);
    layerIds.push(layerId);
  }
  if (layers.includes("depth-area")) {
    const layerId = `chart-depth-area-${index}`;
    map.addLayer({
      id: layerId,
      type: "fill",
      source: sourceId,
      "source-layer": "depth-area",
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "minimumDepth"], 0],
          0, "#b7e6ee",
          12, "#d8f3f5",
        ],
        "fill-opacity": 0.88,
      },
    }, beforeId);
    layerIds.push(layerId);
  }

  if (layers.includes("depth-contour")) {
    const layerId = `chart-depth-contour-${index}`;
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      "source-layer": "depth-contour",
      paint: { "line-color": "#367a90", "line-width": 1.5 },
    }, beforeId);
    layerIds.push(layerId);
  }

  if (layers.includes("coastline")) {
    const layerId = `chart-coastline-${index}`;
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      "source-layer": "coastline",
      paint: { "line-color": "#282716", "line-width": 3 },
    }, beforeId);
    layerIds.push(layerId);
  }

  if (layers.includes("sounding")) {
    const hitLayerId = `chart-sounding-hit-${index}`;
    map.addLayer({
      id: hitLayerId,
      type: "circle",
      source: sourceId,
      "source-layer": "sounding",
      minzoom: 9,
      paint: {
        "circle-color": "rgba(0, 0, 0, 0)",
        "circle-radius": 12,
      },
    }, beforeId);
    layerIds.push(hitLayerId);
    const labelLayerId = `chart-sounding-label-${index}`;
    map.addLayer({
      id: labelLayerId,
      type: "symbol",
      source: sourceId,
      "source-layer": "sounding",
      minzoom: 9,
      layout: {
        "text-field": soundingLabelExpression(displayUnit),
        "text-font": ["Open Sans Regular"],
        "text-size": 12,
        "text-allow-overlap": false,
        "text-padding": 3,
      },
      paint: {
        "text-color": "#173948",
        "text-halo-color": "#f5fbfc",
        "text-halo-width": 1.5,
      },
    }, beforeId);
    layerIds.push(labelLayerId);
    addSoundingInteraction(map, hitLayerId, displayUnit);
  }
  return layerIds;
}

function positionLayerId(map: MapLibreMap): string | undefined {
  if (map.getLayer(POSITION_ACCURACY_LAYER_ID)) return POSITION_ACCURACY_LAYER_ID;
  if (map.getLayer(POSITION_FIX_LAYER_ID)) return POSITION_FIX_LAYER_ID;
  return undefined;
}

function soundingLabelExpression(unit: DepthUnit): ["number-format", ["*", ["get", "depth"], number], object] {
  const conversionFactor = unit === "foot" ? 3.28084 : unit === "fathom" ? 0.546807 : 1;
  return [
    "number-format",
    ["*", ["get", "depth"], conversionFactor],
    { "min-fraction-digits": 1, "max-fraction-digits": 1 },
  ];
}

export function addDemoChartLayers(map: MapLibreMap): void {
  map.addSource(DEMO_SOURCE_IDS.depthArea, { type: "geojson", data: demoDepthAreas });
  map.addLayer({
    id: "depth-area-fill",
    type: "fill",
    source: DEMO_SOURCE_IDS.depthArea,
    paint: {
      "fill-color": [
        "interpolate", ["linear"], ["get", "minimumDepth"],
        0, "#b7e6ee",
        12, "#d8f3f5",
      ],
      "fill-opacity": 0.88,
    },
  });

  map.addSource(DEMO_SOURCE_IDS.depthContour, { type: "geojson", data: demoDepthContours });
  map.addLayer({
    id: "depth-contour-line",
    type: "line",
    source: DEMO_SOURCE_IDS.depthContour,
    paint: { "line-color": "#367a90", "line-width": 1.5 },
  });

  map.addSource(DEMO_SOURCE_IDS.coastline, { type: "geojson", data: demoCoastline });
  map.addLayer({
    id: "coastline-line",
    type: "line",
    source: DEMO_SOURCE_IDS.coastline,
    paint: { "line-color": "#282716", "line-width": 3 },
  });

  map.addSource(DEMO_SOURCE_IDS.sounding, { type: "geojson", data: demoSoundings });
  map.addLayer({
    id: "sounding-point",
    type: "circle",
    source: DEMO_SOURCE_IDS.sounding,
    minzoom: 9,
    paint: {
      "circle-color": "#173948",
      "circle-radius": 5,
      "circle-stroke-color": "#f5fbfc",
      "circle-stroke-width": 1.5,
    },
  });

  map.on("mouseenter", "sounding-point", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "sounding-point", () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", "sounding-point", (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    const depth = feature?.properties?.depth;
    if (typeof depth !== "number") return;

    new Popup({ closeButton: true, focusAfterOpen: true })
      .setLngLat(event.lngLat)
      .setText(`${depth.toFixed(1)} metres`)
      .addTo(map);
  });
}

function addSoundingInteraction(map: MapLibreMap, layerId: string, displayUnit: DepthUnit): void {
  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", layerId, (event: MapLayerMouseEvent) => {
    const depth = event.features?.[0]?.properties?.depth;
    if (typeof depth !== "number") return;
    const convertedDepth = convertMetres(depth, displayUnit);
    new Popup({ closeButton: true, focusAfterOpen: true })
      .setLngLat(event.lngLat)
      .setText(`${formatDepth(convertedDepth)} ${unitLabel(displayUnit)}`)
      .addTo(map);
  });
}

function convertMetres(depth: number, unit: DepthUnit): number {
  if (unit === "foot") return depth * 3.28084;
  if (unit === "fathom") return depth * 0.546807;
  return depth;
}

function formatDepth(depth: number): string {
  return depth.toFixed(1);
}

function unitLabel(unit: DepthUnit): string {
  if (unit === "foot") return "feet";
  if (unit === "fathom") return "fathoms";
  return "metres";
}
