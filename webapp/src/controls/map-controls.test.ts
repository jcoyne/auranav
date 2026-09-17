import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapControls, type MapActions } from "./map-controls";

describe("MapControls", () => {
  let container: HTMLElement;
  let map: MapActions;

  beforeEach(() => {
    container = document.createElement("div");
    map = { panBy: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() };
  });

  it("provides named buttons for every map action", () => {
    new MapControls(container, { map, onFollowChange: vi.fn() });
    const names = [...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "Pan up", "Pan left", "Pan right", "Pan down",
      "Zoom in", "Zoom out", "Center and follow your location",
    ]);
  });

  it("pans and zooms through the injected map interface", () => {
    new MapControls(container, { map, onFollowChange: vi.fn() });
    getButton("Pan up").click();
    getButton("Pan left").click();
    getButton("Pan right").click();
    getButton("Pan down").click();
    getButton("Zoom in").click();
    expect(map.panBy).toHaveBeenNthCalledWith(1, [0, -120]);
    expect(map.panBy).toHaveBeenNthCalledWith(2, [-120, 0]);
    expect(map.panBy).toHaveBeenNthCalledWith(3, [120, 0]);
    expect(map.panBy).toHaveBeenNthCalledWith(4, [0, 120]);
    expect(map.zoomIn).toHaveBeenCalledOnce();
  });

  it("toggles follow state and exposes it with aria-pressed", () => {
    const onFollowChange = vi.fn();
    const controls = new MapControls(container, { map, onFollowChange });
    const button = getButton("Center and follow your location");
    button.click();
    expect(controls.isFollowing).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(onFollowChange).toHaveBeenLastCalledWith(true);
    button.click();
    expect(onFollowChange).toHaveBeenLastCalledWith(false);
  });

  function getButton(name: string): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.getAttribute("aria-label") === name);
    if (!button) throw new Error(`Button ${name} not found`);
    return button;
  }
});
