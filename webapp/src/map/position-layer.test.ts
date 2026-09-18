import type { FeatureCollection, Point, Polygon } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { addPositionLayer, updatePositionLayer } from "./position-layer";

function position(accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude: 43,
      longitude: -87.9,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: 1234,
    toJSON: () => ({}),
  };
}

describe("position layer", () => {
  it("draws the reported accuracy radius and marks stale geometry", () => {
    const setData = vi.fn();
    const map = {
      getSource: vi.fn(() => ({ setData }) as unknown as GeoJSONSource),
    } as unknown as MapLibreMap;

    updatePositionLayer(map, position(100), true);

    const data = setData.mock.calls[0]?.[0] as FeatureCollection<Polygon | Point>;
    const accuracy = data.features[0];
    const fix = data.features[1];
    expect(accuracy?.geometry.type).toBe("Polygon");
    expect(accuracy?.properties).toEqual({ accuracy: 100, stale: true });
    expect(fix?.geometry).toEqual({ type: "Point", coordinates: [-87.9, 43] });
    expect(fix?.properties).toEqual({ timestamp: 1234, stale: true });

    if (accuracy?.geometry.type !== "Polygon") throw new Error("Expected accuracy polygon");
    const eastEdge = accuracy.geometry.coordinates[0]?.[0];
    expect(eastEdge?.[0]).toBeGreaterThan(-87.9);
    expect(eastEdge?.[1]).toBeCloseTo(43, 8);
  });

  it("uses stale-aware colors for the accuracy circle and position fix", () => {
    const addLayer = vi.fn();
    const map = { addSource: vi.fn(), addLayer } as unknown as MapLibreMap;

    addPositionLayer(map);

    expect(addLayer.mock.calls[0]?.[0].paint["fill-color"])
      .toEqual(["case", ["get", "stale"], "#6b7780", "#087fcb"]);
    expect(addLayer.mock.calls[1]?.[0].paint["circle-color"])
      .toEqual(["case", ["get", "stale"], "#6b7780", "#087fcb"]);
  });
});
