import type { Feature, FeatureCollection, Point, Polygon, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

const SOURCE_ID = "device-position";
export const POSITION_ACCURACY_LAYER_ID = "position-accuracy";
export const POSITION_FIX_LAYER_ID = "position-fix";

export function addPositionLayer(map: MapLibreMap): void {
  map.addSource(SOURCE_ID, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: POSITION_ACCURACY_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": ["case", ["get", "stale"], "#6b7780", "#087fcb"],
      "fill-opacity": ["case", ["get", "stale"], 0.1, 0.16],
      "fill-outline-color": ["case", ["get", "stale"], "#6b7780", "#087fcb"],
    },
  });
  map.addLayer({
    id: POSITION_FIX_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 7,
      "circle-color": ["case", ["get", "stale"], "#6b7780", "#087fcb"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
}

export function updatePositionLayer(
  map: MapLibreMap,
  position: GeolocationPosition,
  stale = false,
): void {
  const source = map.getSource<GeoJSONSource>(SOURCE_ID);
  if (!source) return;

  const center: Position = [position.coords.longitude, position.coords.latitude];
  const point: Feature<Point> = {
    type: "Feature",
    properties: { timestamp: position.timestamp, stale },
    geometry: { type: "Point", coordinates: center },
  };
  source.setData({
    type: "FeatureCollection",
    features: [accuracyCircle(center, position.coords.accuracy, stale), point],
  });
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function accuracyCircle(center: Position, radiusMetres: number, stale: boolean): Feature<Polygon> {
  const [longitude = 0, latitude = 0] = center;
  const latitudeRadians = latitude * Math.PI / 180;
  const latitudeDegreesPerMetre = 1 / 111_320;
  const longitudeDegreesPerMetre = 1 / (111_320 * Math.max(Math.cos(latitudeRadians), 0.01));
  const safeRadiusMetres = Number.isFinite(radiusMetres) ? Math.max(radiusMetres, 0) : 0;
  const ring: Position[] = [];

  for (let index = 0; index <= 48; index += 1) {
    const angle = index / 48 * Math.PI * 2;
    ring.push([
      longitude + Math.cos(angle) * safeRadiusMetres * longitudeDegreesPerMetre,
      latitude + Math.sin(angle) * safeRadiusMetres * latitudeDegreesPerMetre,
    ]);
  }

  return {
    type: "Feature",
    properties: { accuracy: safeRadiusMetres, stale },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}
