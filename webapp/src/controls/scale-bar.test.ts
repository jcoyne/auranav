import { describe, expect, it, vi } from "vitest";
import { chooseScaleBar, ScaleBar, type ScalableMap } from "./scale-bar";
import { groundResolutionMetresPerPixel } from "../map/chart-scale";

const NM = 1852;
const FOOT = 0.3048;

describe("choosing a scale bar length", () => {
  it("takes the longest allowed length that fits the space", () => {
    // 100 px of budget at 20 m/px is 2000 m, which 1 NM fits inside and 2 NM does not.
    expect(chooseScaleBar(20, 100)).toEqual({ label: "1 NM", lengthPx: NM / 20 });
  });

  it("steps down a value rather than stretching as you zoom in", () => {
    const zoomedOut = chooseScaleBar(40, 100);
    const zoomedIn = chooseScaleBar(20, 100);
    expect(zoomedOut?.label).toBe("2 NM");
    expect(zoomedIn?.label).toBe("1 NM");
    // Both still fit, which is the point of choosing a length over scaling one.
    expect(zoomedOut?.lengthPx).toBeLessThanOrEqual(100);
    expect(zoomedIn?.lengthPx).toBeLessThanOrEqual(100);
  });

  it("measures a harbour in feet, where a nautical mile would need decimals", () => {
    expect(chooseScaleBar(0.5, 100)?.label).toBe("100 ft");
    expect(chooseScaleBar(2, 100)?.label).toBe("500 ft");
  });

  it("keeps the shortest length past maximum zoom instead of vanishing", () => {
    const reading = chooseScaleBar(0.01, 100);
    expect(reading?.label).toBe("50 ft");
    expect(reading?.lengthPx).toBeCloseTo(50 * FOOT / 0.01, 5);
  });

  it("reports nothing for a degenerate viewport", () => {
    expect(chooseScaleBar(0, 100)).toBeUndefined();
    expect(chooseScaleBar(Number.NaN, 100)).toBeUndefined();
    expect(chooseScaleBar(20, 0)).toBeUndefined();
  });
});

describe("the scale bar control", () => {
  function fakeMap(zoom: number): ScalableMap & { fire(): void } {
    let listener = (): void => undefined;
    return {
      getZoom: () => zoom,
      getCenter: () => ({ lat: 46.9 }),
      on: (_type, fn) => { listener = fn as () => void; return undefined; },
      fire: () => listener(),
    };
  }

  it("restates its length when the map moves", () => {
    const container = document.createElement("div");
    let zoom = 8;
    const map = fakeMap(zoom);
    const bar = new ScaleBar(container, { ...map, getZoom: () => zoom, on: map.on }, 184);
    const atLowZoom = container.textContent;

    zoom = 14;
    bar.update();

    expect(container.textContent).not.toBe(atLowZoom);
    expect(container.querySelector(".scale-bar-rule")).not.toBeNull();
  });

  it("never draws a bar wider than its budget at any zoom the app allows", () => {
    // minZoom 3 through maxZoom 18, at the latitude of the Apostle Islands.
    for (let zoom = 3; zoom <= 18; zoom += 1) {
      const reading = chooseScaleBar(groundResolutionMetresPerPixel(zoom, 46.9), 184);
      expect(reading).toBeDefined();
      if (zoom < 18) expect(reading?.lengthPx).toBeLessThanOrEqual(184);
    }
  });

  it("subscribes to map movement", () => {
    const container = document.createElement("div");
    const on = vi.fn();
    new ScaleBar(container, { getZoom: () => 12, getCenter: () => ({ lat: 46.9 }), on }, 184);
    expect(on).toHaveBeenCalledWith("move", expect.any(Function));
  });
});
