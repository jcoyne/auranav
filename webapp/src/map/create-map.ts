import { AttributionControl, Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
// maplibre-gl derives its worker URL from `new URL("./maplibre-gl-worker.mjs", import.meta.url)`
// at runtime. A bundled entry chunk resolves that to a sibling of itself in the build output,
// where the worker was never emitted, so the request returns the host's 404 page instead.
// `?worker&url` makes Vite bundle the worker with its shared dependency and emit it as an asset.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);

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
      glyphs: `${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`,
      sources: {},
      layers: [{ id: "water", type: "background", paint: { "background-color": "#d8f3f5" } }],
    },
  });

  map.addControl(new AttributionControl({ compact: true }), "bottom-right");
  return map;
}
