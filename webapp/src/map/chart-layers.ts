import type { ChartLayer, ChartPackageManifest, DepthUnit } from "../chart-package";
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
): void {
  registerPmtilesProtocol();

  manifest.tileSets.forEach((tileSet, index) => {
    if (tileSet.format !== "pmtiles") return;
    const archiveUrl = resolvePackageAssetUrl(tileSet.url, manifestUrl).href;
    protocol.add(new PMTiles(archiveUrl));
    const sourceId = `chart-${index}`;
    map.addSource(sourceId, {
      type: "vector",
      url: `pmtiles://${archiveUrl}`,
      attribution: "NOAA Office of Coast Survey",
      minzoom: tileSet.minZoom,
      maxzoom: tileSet.maxZoom,
    });
    addVectorLayers(map, sourceId, index, tileSet.layers, manifest.depth.displayUnit);
  });
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
  layers: ChartLayer[],
  displayUnit: DepthUnit,
): void {
  if (layers.includes("depth-area")) {
    map.addLayer({
      id: `chart-depth-area-${index}`,
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
    });
  }

  if (layers.includes("depth-contour")) {
    map.addLayer({
      id: `chart-depth-contour-${index}`,
      type: "line",
      source: sourceId,
      "source-layer": "depth-contour",
      paint: { "line-color": "#367a90", "line-width": 1.5 },
    });
  }

  if (layers.includes("coastline")) {
    map.addLayer({
      id: `chart-coastline-${index}`,
      type: "line",
      source: sourceId,
      "source-layer": "coastline",
      paint: { "line-color": "#282716", "line-width": 3 },
    });
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
    });
    map.addLayer({
      id: `chart-sounding-label-${index}`,
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
    });
    addSoundingInteraction(map, hitLayerId, displayUnit);
  }
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
