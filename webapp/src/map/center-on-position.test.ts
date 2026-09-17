import { describe, expect, it, vi } from "vitest";
import { centerMapOn, type CenterableMap } from "./center-on-position";

describe("centerMapOn", () => {
  it("centers on the GPS coordinates and raises a distant view to location zoom", () => {
    const map: CenterableMap = { getZoom: () => 8, easeTo: vi.fn() };
    const position = {
      coords: { latitude: 43.04, longitude: -87.91 },
      timestamp: 123,
    } as GeolocationPosition;

    centerMapOn(map, position);

    expect(map.easeTo).toHaveBeenCalledWith({ center: [-87.91, 43.04], zoom: 14 });
  });

  it("preserves a closer zoom level", () => {
    const map: CenterableMap = { getZoom: () => 16, easeTo: vi.fn() };
    const position = {
      coords: { latitude: 43.04, longitude: -87.91 },
      timestamp: 123,
    } as GeolocationPosition;

    centerMapOn(map, position);

    expect(map.easeTo).toHaveBeenCalledWith({ center: [-87.91, 43.04], zoom: 16 });
  });
});
