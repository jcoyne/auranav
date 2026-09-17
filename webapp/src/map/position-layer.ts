import type { Feature, FeatureCollection, Point, Polygon, Position } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

const SOURCE_ID = "device-position";

export function addPositionLayer(map: MapLibreMap): void {
  map.addSource(SOURCE_ID, { type: "geojson", data: emptyCollection() });
  map.addLayer({
    id: "position-accuracy",
    type: "fill",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": "#087fcb",
      "fill-opacity": 0.16,
      "fill-outline-color": "#087fcb",
    },
  });
  map.addLayer({
    id: "position-fix",
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 7,
      "circle-color": "#087fcb",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
}

export function updatePositionLayer(map: MapLibreMap, position: GeolocationPosition): void {
  const source = map.getSource<GeoJSONSource>(SOURCE_ID);
  if (!source) return;

  const center: Position = [position.coords.longitude, position.coords.latitude];
  const point: Feature<Point> = {
    type: "Feature",
    properties: { timestamp: position.timestamp },
    geometry: { type: "Point", coordinates: center },
  };
  source.setData({
    type: "FeatureCollection",
    features: [accuracyCircle(center, position.coords.accuracy), point],
  });
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function accuracyCircle(center: Position, radiusMetres: number): Feature<Polygon> {
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
    properties: { accuracy: safeRadiusMetres },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}
