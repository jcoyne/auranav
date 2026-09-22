import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";

const popups: FakePopup[] = [];

/** MapLibre's `Popup` needs a live map and a WebGL canvas, so stand one in. */
class FakePopup {
  lngLat: unknown;
  text: string | undefined;
  domContent: HTMLElement | undefined;
  added = false;
  removed = false;
  readonly closeListeners: (() => void)[] = [];

  constructor(public readonly options: unknown) {
    popups.push(this);
  }

  setLngLat(lngLat: unknown): this {
    this.lngLat = lngLat;
    return this;
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  setDOMContent(element: HTMLElement): this {
    this.domContent = element;
    return this;
  }

  on(_type: string, listener: () => void): this {
    this.closeListeners.push(listener);
    return this;
  }

  addTo(_map: unknown): this {
    this.added = true;
    return this;
  }

  remove(): this {
    this.removed = true;
    this.closeListeners.forEach((listener) => listener());
    return this;
  }
}

vi.mock("maplibre-gl", () => ({ Popup: FakePopup }));

const { createPopupDispatcher } = await import("./popup-dispatcher");
const { POINT_FEATURE, USER_MARK_FEATURE } = await import("./feature-popup");

type ClickHandler = (event: { point: unknown; lngLat: unknown }) => void;

function fakeMap(features: { layer: { id: string }; properties: Record<string, unknown> }[]): {
  map: MapLibreMap;
  click: () => void;
  clickHandlers: ClickHandler[];
} {
  const clickHandlers: ClickHandler[] = [];
  const map = {
    on: vi.fn((type: string, handler: ClickHandler) => {
      if (type === "click") clickHandlers.push(handler);
    }),
    queryRenderedFeatures: vi.fn(() => features),
  } as unknown as MapLibreMap;
  return {
    map,
    clickHandlers,
    click: () => clickHandlers.forEach((handler) => handler({ point: { x: 1, y: 2 }, lngLat: { lng: -90.8, lat: 46.8 } })),
  };
}

describe("popup dispatcher", () => {
  beforeEach(() => {
    popups.length = 0;
  });

  it("answers every tap with one handler, whatever registered", () => {
    const { map } = fakeMap([]);
    const dispatcher = createPopupDispatcher(map);
    dispatcher.register({ layerId: "a", peerPrefix: "a", precedence: POINT_FEATURE, format: () => "a" });
    dispatcher.register({ layerId: "b", peerPrefix: "b", precedence: POINT_FEATURE, format: () => "b" });

    expect(vi.mocked(map.on).mock.calls.filter(([type, arg]) => type === "click" && typeof arg === "function"))
      .toHaveLength(1);
  });

  it("describes a charted feature as text", () => {
    const { map, click } = fakeMap([{ layer: { id: "chart-sounding-hit-0" }, properties: { depth: 3 } }]);
    const dispatcher = createPopupDispatcher(map);
    dispatcher.register({
      layerId: "chart-sounding-hit-0",
      peerPrefix: "chart-sounding-hit-",
      precedence: POINT_FEATURE,
      format: (properties) => `${String(properties.depth)} metres`,
    });

    click();

    expect(popups).toHaveLength(1);
    expect(popups[0]?.text).toBe("3 metres");
    expect(popups[0]?.domContent).toBeUndefined();
    expect(popups[0]?.added).toBe(true);
    expect(popups[0]?.lngLat).toEqual({ lng: -90.8, lat: 46.8 });
  });

  it("lets the user's mark beat the chart feature underneath it and show controls", () => {
    // MapLibre returns the topmost feature first; the sounding is on top of
    // the mark's hit target here, and the mark still wins.
    const { map, click } = fakeMap([
      { layer: { id: "chart-sounding-hit-0" }, properties: { depth: 3 } },
      { layer: { id: "range-mark-hit" }, properties: {} },
    ]);
    const dispatcher = createPopupDispatcher(map);
    const panel = document.createElement("div");
    panel.textContent = "Remove mark";
    dispatcher.register({
      layerId: "chart-sounding-hit-0",
      peerPrefix: "chart-sounding-hit-",
      precedence: POINT_FEATURE,
      format: () => "3 metres",
    });
    dispatcher.register({
      layerId: "range-mark-hit",
      peerPrefix: "range-mark-hit",
      precedence: USER_MARK_FEATURE,
      render: () => panel,
    });

    click();

    expect(popups).toHaveLength(1);
    expect(popups[0]?.domContent).toBe(panel);
    expect(popups[0]?.text).toBeUndefined();
  });

  it("closes the previous popup rather than stacking a second one", () => {
    const { map, click } = fakeMap([{ layer: { id: "a" }, properties: { label: "x" } }]);
    const dispatcher = createPopupDispatcher(map);
    dispatcher.register({ layerId: "a", peerPrefix: "a", precedence: POINT_FEATURE, format: () => "x" });

    click();
    click();

    expect(popups).toHaveLength(2);
    expect(popups[0]?.removed).toBe(true);
    expect(popups[1]?.removed).toBe(false);
  });

  it("closes the open popup on request, for when what it described has gone", () => {
    const { map, click } = fakeMap([{ layer: { id: "a" }, properties: { label: "x" } }]);
    const dispatcher = createPopupDispatcher(map);
    dispatcher.register({ layerId: "a", peerPrefix: "a", precedence: POINT_FEATURE, format: () => "x" });

    click();
    dispatcher.closePopup();
    dispatcher.closePopup();

    expect(popups).toHaveLength(1);
    expect(popups[0]?.removed).toBe(true);
  });

  it("stays quiet when nothing tappable was hit or a feature has nothing to say", () => {
    const { map, click } = fakeMap([{ layer: { id: "a" }, properties: { label: "x" } }]);
    const dispatcher = createPopupDispatcher(map);
    dispatcher.register({ layerId: "a", peerPrefix: "a", precedence: POINT_FEATURE, format: () => "" });

    click();
    expect(popups).toHaveLength(0);
  });
});
