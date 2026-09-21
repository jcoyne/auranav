import { beforeEach, describe, expect, it, vi } from "vitest";
import { NorthIndicator, type RotatableMap } from "./north-indicator";

describe("NorthIndicator", () => {
  let container: HTMLElement;
  let bearing: number;
  let rotated: (() => void) | undefined;
  let map: RotatableMap;

  beforeEach(() => {
    container = document.createElement("div");
    bearing = 0;
    rotated = undefined;
    map = {
      getBearing: () => bearing,
      resetNorth: vi.fn(() => { bearing = 0; rotated?.(); }),
      on: vi.fn((_type, listener: () => void) => { rotated = listener; }),
    };
  });

  it("starts north up and announces the orientation", () => {
    new NorthIndicator(container, map);

    expect(button().getAttribute("aria-label")).toBe("Map is oriented north up");
    expect(button().classList.contains("is-north-up")).toBe(true);
    expect(needle().style.transform).toBe("rotate(0deg)");
  });

  it("counter-rotates the needle so it keeps pointing at north", () => {
    new NorthIndicator(container, map);

    bearing = 90;
    rotated?.();

    expect(needle().style.transform).toBe("rotate(-90deg)");
    expect(button().getAttribute("aria-label")).toBe("Map rotated 90°. Reset to north up.");
    expect(button().classList.contains("is-north-up")).toBe(false);
  });

  it("normalizes bearings outside 0–360", () => {
    new NorthIndicator(container, map);

    bearing = -45;
    rotated?.();
    expect(needle().style.transform).toBe("rotate(-315deg)");

    bearing = 359.9;
    rotated?.();
    expect(button().classList.contains("is-north-up")).toBe(true);
  });

  it("returns the map to north up when activated", () => {
    new NorthIndicator(container, map);
    bearing = 200;
    rotated?.();

    button().click();

    expect(map.resetNorth).toHaveBeenCalledOnce();
    expect(needle().style.transform).toBe("rotate(0deg)");
    expect(button().getAttribute("aria-label")).toBe("Map is oriented north up");
  });

  function button(): HTMLButtonElement {
    const found = container.querySelector("button");
    if (!found) throw new Error("Compass button not found");
    return found;
  }

  function needle(): SVGElement {
    const found = container.querySelector("svg");
    if (!found) throw new Error("Compass needle not found");
    return found;
  }
});
