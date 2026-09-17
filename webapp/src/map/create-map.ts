import { AttributionControl, Map as MapLibreMap } from "maplibre-gl";
import { addDemoChartLayers } from "./chart-layers";

export function createMap(container: HTMLElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    center: [-87.83, 43.04],
    zoom: 10.5,
    minZoom: 3,
    maxZoom: 18,
    attributionControl: false,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "water", type: "background", paint: { "background-color": "#d8f3f5" } }],
    },
  });

  map.addControl(new AttributionControl({ compact: true }), "bottom-right");
  map.on("load", () => addDemoChartLayers(map));
  return map;
}
