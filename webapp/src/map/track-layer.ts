import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { trackToGeoJson, type Track } from "../track/track-store";

const SOURCE_ID = "recorded-track";
export const TRACK_CASING_LAYER_ID = "track-line-casing";
export const TRACK_LINE_LAYER_ID = "track-line";

const TRACK_COLOR = "#ffd21e";
/** Yellow alone disappears over shoal and land tints, so the line carries a dark casing. */
const TRACK_CASING_COLOR = "#3f2d00";

export function addTrackLayer(map: MapLibreMap): void {
  map.addSource(SOURCE_ID, { type: "geojson", data: trackToGeoJson({ segments: [], trimmed: false }) });
  map.addLayer({
    id: TRACK_CASING_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": TRACK_CASING_COLOR,
      "line-width": 6,
      "line-opacity": 0.55,
    },
  });
  map.addLayer({
    id: TRACK_LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": TRACK_COLOR,
      "line-width": 3,
    },
  });
}

export function updateTrackLayer(map: MapLibreMap, track: Track): void {
  const source = map.getSource<GeoJSONSource>(SOURCE_ID);
  if (!source) return;
  source.setData(trackToGeoJson(track));
}

/** Hiding rather than removing keeps the recorded geometry ready for the next toggle. */
export function setTrackLayerVisible(map: MapLibreMap, visible: boolean): void {
  for (const layerId of [TRACK_CASING_LAYER_ID, TRACK_LINE_LAYER_ID]) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}
