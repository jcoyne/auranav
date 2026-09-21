import type { FeatureCollection, LineString } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import {
  TRACK_CASING_LAYER_ID,
  TRACK_LINE_LAYER_ID,
  addTrackLayer,
  setTrackLayerVisible,
  updateTrackLayer,
} from "./track-layer";
import type { Track } from "../track/track-store";

const track: Track = {
  segments: [
    [
      { longitude: -87.9, latitude: 43, time: 1 },
      { longitude: -87.8, latitude: 43.1, time: 15_001 },
    ],
    [{ longitude: -87.5, latitude: 43.4, time: 900_000 }],
  ],
  trimmed: false,
};

describe("track layer", () => {
  it("draws the track in yellow over a dark casing", () => {
    const addLayer = vi.fn();
    addTrackLayer({ addSource: vi.fn(), addLayer } as unknown as MapLibreMap);

    const [casing, line] = addLayer.mock.calls.map((call) => call[0]);
    expect(casing.id).toBe(TRACK_CASING_LAYER_ID);
    expect(line.id).toBe(TRACK_LINE_LAYER_ID);
    expect(line.paint["line-color"]).toBe("#ffd21e");
    // The casing is drawn first and wider, so the yellow reads over light chart fills.
    expect(casing.paint["line-width"]).toBeGreaterThan(line.paint["line-width"]);
  });

  it("publishes each recorded polyline to the source", () => {
    const setData = vi.fn();
    const map = { getSource: vi.fn(() => ({ setData }) as unknown as GeoJSONSource) } as unknown as MapLibreMap;

    updateTrackLayer(map, track);

    const data = setData.mock.calls[0]?.[0] as FeatureCollection<LineString>;
    expect(data.features).toHaveLength(1);
    expect(data.features[0]?.geometry.coordinates).toEqual([[-87.9, 43], [-87.8, 43.1]]);
  });

  it("does nothing before the source exists", () => {
    const map = { getSource: vi.fn(() => undefined) } as unknown as MapLibreMap;
    expect(() => updateTrackLayer(map, track)).not.toThrow();
  });

  it("hides and shows both layers without discarding the geometry", () => {
    const setLayoutProperty = vi.fn();
    const map = { getLayer: vi.fn(() => ({})), setLayoutProperty } as unknown as MapLibreMap;

    setTrackLayerVisible(map, false);
    setTrackLayerVisible(map, true);

    expect(setLayoutProperty.mock.calls).toEqual([
      [TRACK_CASING_LAYER_ID, "visibility", "none"],
      [TRACK_LINE_LAYER_ID, "visibility", "none"],
      [TRACK_CASING_LAYER_ID, "visibility", "visible"],
      [TRACK_LINE_LAYER_ID, "visibility", "visible"],
    ]);
  });

  it("skips layers the style has not added yet", () => {
    const setLayoutProperty = vi.fn();
    const map = { getLayer: vi.fn(() => undefined), setLayoutProperty } as unknown as MapLibreMap;

    setTrackLayerVisible(map, true);

    expect(setLayoutProperty).not.toHaveBeenCalled();
  });
});
