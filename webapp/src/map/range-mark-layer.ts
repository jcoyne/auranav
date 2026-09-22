import type { Feature, FeatureCollection, LineString, Point, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "./range-bearing";

const SOURCE_ID = "range-mark";
export const RANGE_MARK_LINE_LAYER_ID = "range-mark-line";
export const RANGE_MARK_RING_LAYER_ID = "range-mark-ring";
export const RANGE_MARK_CENTRE_LAYER_ID = "range-mark-centre";
/** The tap target, registered with the popup dispatcher. Draws nothing. */
export const RANGE_MARK_HIT_LAYER_ID = "range-mark-hit";

/**
 * Magenta, which nothing charted in this app uses. A user mark is not a
 * charted object and must never be mistaken for one; the GPS fix is blue and
 * the recorded track is yellow.
 */
const MARK_COLOR = "#c2158f";
const STALE_COLOR = "#6b7780";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

export type RangeMarkView = {
  /** Where the user put the mark, or nothing when there is no mark. */
  readonly mark?: LatLng | undefined;
  /** The position the range is measured from, when there is a fix. */
  readonly from?: LatLng | undefined;
  /** Drawn in grey when the fix the line starts from is stale. */
  readonly stale?: boolean;
};

/**
 * Adds the mark's layers. Call after the position layers so the mark and its
 * range line draw over the chart and over the fix.
 */
export function addRangeMarkLayer(map: MapLibreMap): void {
  map.addSource(SOURCE_ID, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: RANGE_MARK_LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round" },
    paint: {
      // Dashed, so the range line cannot read as a charted line such as a
      // cable or a depth contour.
      "line-dasharray": [2, 2],
      "line-color": ["case", ["get", "stale"], STALE_COLOR, MARK_COLOR],
      "line-width": 2,
    },
  });
  map.addLayer({
    id: RANGE_MARK_RING_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 10,
      "circle-color": TRANSPARENT,
      "circle-stroke-color": MARK_COLOR,
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: RANGE_MARK_CENTRE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 2.5,
      "circle-color": MARK_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: RANGE_MARK_HIT_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    // Wider than the ring, because the mark is tapped to remove it and a
    // 10 px ring is smaller than a fingertip.
    paint: { "circle-color": TRANSPARENT, "circle-radius": 22 },
  });
}

/** Redraws the mark and the range line. An empty view clears both. */
export function updateRangeMarkLayer(map: MapLibreMap, view: RangeMarkView): void {
  const source = map.getSource<GeoJSONSource>(SOURCE_ID);
  if (!source) return;
  source.setData(rangeMarkGeoJson(view));
}

/** Exported for testing: the geometry the layers draw. */
export function rangeMarkGeoJson(view: RangeMarkView): FeatureCollection<Point | LineString> {
  const { mark, from } = view;
  if (mark === undefined) return emptyCollection();

  const stale = view.stale === true;
  const markPoint: Feature<Point> = {
    type: "Feature",
    properties: { stale },
    geometry: { type: "Point", coordinates: toPosition(mark) },
  };
  if (from === undefined) return { type: "FeatureCollection", features: [markPoint] };

  const rangeLine: Feature<LineString> = {
    type: "Feature",
    properties: { stale },
    geometry: { type: "LineString", coordinates: [toPosition(from), toPosition(mark)] },
  };
  // The line is listed first so it is drawn beneath the mark itself.
  return { type: "FeatureCollection", features: [rangeLine, markPoint] };
}

function toPosition(point: LatLng): Position {
  return [point.longitude, point.latitude];
}

function emptyCollection(): FeatureCollection<Point | LineString> {
  return { type: "FeatureCollection", features: [] };
}
