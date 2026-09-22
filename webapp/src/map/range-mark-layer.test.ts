import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it, vi } from "vitest";
import {
  addRangeMarkLayer,
  RANGE_MARK_CENTRE_LAYER_ID,
  RANGE_MARK_HIT_LAYER_ID,
  RANGE_MARK_LINE_LAYER_ID,
  RANGE_MARK_RING_LAYER_ID,
  rangeMarkGeoJson,
  updateRangeMarkLayer,
} from "./range-mark-layer";

const MARK = { latitude: 46.81, longitude: -90.81 };
const FIX = { latitude: 46.7, longitude: -90.75 };

describe("range mark layer", () => {
  it("draws nothing until a mark is placed", () => {
    expect(rangeMarkGeoJson({})).toEqual({ type: "FeatureCollection", features: [] });
    expect(rangeMarkGeoJson({ from: FIX })).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("draws the mark alone when there is no fix to measure from", () => {
    const features = rangeMarkGeoJson({ mark: MARK }).features;

    expect(features).toHaveLength(1);
    expect(features[0]?.geometry).toEqual({ type: "Point", coordinates: [-90.81, 46.81] });
  });

  it("runs the range line from the fix to the mark, beneath the mark itself", () => {
    const features = rangeMarkGeoJson({ mark: MARK, from: FIX, stale: true }).features;

    expect(features.map((feature) => feature.geometry.type)).toEqual(["LineString", "Point"]);
    expect(features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [[-90.75, 46.7], [-90.81, 46.81]],
    });
    expect(features.map((feature) => feature.properties)).toEqual([{ stale: true }, { stale: true }]);
  });

  it("uses a colour and a dash no charted feature uses", () => {
    const addLayer = vi.fn();
    const map = { addSource: vi.fn(), addLayer } as unknown as MapLibreMap;

    addRangeMarkLayer(map);

    const byId = new Map(addLayer.mock.calls.map(([layer]) => [layer.id, layer]));
    expect([...byId.keys()]).toEqual([
      RANGE_MARK_LINE_LAYER_ID,
      RANGE_MARK_RING_LAYER_ID,
      RANGE_MARK_CENTRE_LAYER_ID,
      RANGE_MARK_HIT_LAYER_ID,
    ]);
    // Magenta, where the GPS fix is blue and the recorded track is yellow.
    expect(byId.get(RANGE_MARK_CENTRE_LAYER_ID)?.paint["circle-color"]).toBe("#c2158f");
    expect(byId.get(RANGE_MARK_LINE_LAYER_ID)?.paint["line-dasharray"]).toEqual([2, 2]);
    expect(byId.get(RANGE_MARK_LINE_LAYER_ID)?.paint["line-color"])
      .toEqual(["case", ["get", "stale"], "#6b7780", "#c2158f"]);
    // The tap target is invisible and bigger than a fingertip.
    expect(byId.get(RANGE_MARK_HIT_LAYER_ID)?.paint["circle-color"]).toBe("rgba(0, 0, 0, 0)");
    expect(byId.get(RANGE_MARK_HIT_LAYER_ID)?.paint["circle-radius"]).toBeGreaterThan(20);
  });

  it("produces layer specifications MapLibre accepts", () => {
    const addLayer = vi.fn();
    const map = { addSource: vi.fn(), addLayer } as unknown as MapLibreMap;

    addRangeMarkLayer(map);

    const errors = validateStyleMin({
      version: 8,
      sources: { "range-mark": { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: addLayer.mock.calls.map(([layer]) => layer) as LayerSpecification[],
    });
    expect(errors.map((error) => `${error.line ?? ""} ${error.message}`)).toEqual([]);
  });

  it("does nothing when the map has no mark source yet", () => {
    const map = { getSource: vi.fn(() => undefined) } as unknown as MapLibreMap;
    expect(() => updateRangeMarkLayer(map, { mark: MARK })).not.toThrow();
  });

  it("pushes the geometry to the source", () => {
    const setData = vi.fn();
    const map = {
      getSource: vi.fn(() => ({ setData }) as unknown as GeoJSONSource),
    } as unknown as MapLibreMap;

    updateRangeMarkLayer(map, { mark: MARK, from: FIX });

    expect(setData).toHaveBeenCalledWith(rangeMarkGeoJson({ mark: MARK, from: FIX }));
  });
});
