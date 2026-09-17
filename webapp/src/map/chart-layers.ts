import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Popup } from "maplibre-gl";
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
