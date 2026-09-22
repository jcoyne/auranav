import type { FeatureCollection, LineString, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRangeBearing } from "../ui/range-bearing-status";
import { type ChartInteraction, USER_MARK_FEATURE } from "./feature-popup";
import { LONG_PRESS_HOLD_MS, LONG_PRESS_MOVE_TOLERANCE_PX } from "./long-press";
import type { PopupDispatcher } from "./popup-dispatcher";
import type { LatLng } from "./range-bearing";
import { RANGE_MARK_HIT_LAYER_ID } from "./range-mark-layer";
import { RangeMark } from "./range-mark";

function position(latitude: number, longitude: number, timestamp = 1_000): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp,
    toJSON: () => ({}),
  };
}

function touch(type: string, clientX = 100, clientY = 100): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX,
    clientY,
  });
}

describe("the user's range mark", () => {
  let canvas: HTMLElement;
  let setData: ReturnType<typeof vi.fn>;
  let map: MapLibreMap;
  let dispatcher: PopupDispatcher;
  let registered: ChartInteraction[];
  let contextMenu: ((event: { lngLat: { lng: number; lat: number } }) => void) | undefined;
  let changes: (LatLng | undefined)[];
  let rangeMark: RangeMark;

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement("div");
    document.body.append(canvas);
    setData = vi.fn();
    registered = [];
    changes = [];
    contextMenu = undefined;
    map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn(() => ({ setData }) as unknown as GeoJSONSource),
      getCanvasContainer: vi.fn(() => canvas),
      // The map is 1000 px wide over one degree of longitude, for arithmetic
      // that is easy to read in the assertions.
      unproject: vi.fn(([x, y]: [number, number]) => ({ lng: -91 + x / 1000, lat: 47 - y / 1000 })),
      on: vi.fn((type: string, handler: unknown) => {
        if (type === "contextmenu") contextMenu = handler as typeof contextMenu;
      }),
    } as unknown as MapLibreMap;
    dispatcher = {
      register: vi.fn((interaction: ChartInteraction) => registered.push(interaction)),
      closePopup: vi.fn(),
    };
    rangeMark = new RangeMark({ map, dispatcher, onChange: (mark) => changes.push(mark) });
  });

  afterEach(() => {
    rangeMark.dispose();
    canvas.remove();
    vi.useRealTimers();
  });

  function lastData(): FeatureCollection<Point | LineString> {
    return setData.mock.calls.at(-1)?.[0] as FeatureCollection<Point | LineString>;
  }

  it("drops a mark where a long press held still", () => {
    canvas.dispatchEvent(touch("pointerdown", 250, 400));
    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS);

    expect(rangeMark.mark).toEqual({ latitude: 46.6, longitude: -90.75 });
    expect(lastData().features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [-90.75, 46.6],
    });
    expect(changes).toEqual([{ latitude: 46.6, longitude: -90.75 }]);
  });

  it("does not drop a mark while the chart is being panned", () => {
    canvas.dispatchEvent(touch("pointerdown", 250, 400));
    canvas.dispatchEvent(touch("pointermove", 250 + LONG_PRESS_MOVE_TOLERANCE_PX + 5, 400));
    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS * 3);

    expect(rangeMark.mark).toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("drops a mark from the desktop context menu too", () => {
    contextMenu?.({ lngLat: { lng: -90.81, lat: 46.81 } });

    expect(rangeMark.mark).toEqual({ latitude: 46.81, longitude: -90.81 });
  });

  it("keeps exactly one mark: a new press moves it", () => {
    contextMenu?.({ lngLat: { lng: -90.81, lat: 46.81 } });
    contextMenu?.({ lngLat: { lng: -90.7, lat: 46.9 } });

    expect(rangeMark.mark).toEqual({ latitude: 46.9, longitude: -90.7 });
    expect(lastData().features.filter((feature) => feature.geometry.type === "Point")).toHaveLength(1);
    // The popup describing the mark's old location must not linger.
    expect(dispatcher.closePopup).toHaveBeenCalled();
  });

  it("draws the range line from the fix and greys it out when the fix is stale", () => {
    contextMenu?.({ lngLat: { lng: -90.81, lat: 46.81 } });
    rangeMark.measureFrom(position(46.7, -90.75), false);

    expect(lastData().features[0]).toMatchObject({
      geometry: { type: "LineString", coordinates: [[-90.75, 46.7], [-90.81, 46.81]] },
      properties: { stale: false },
    });

    rangeMark.measureFrom(position(46.7, -90.75), true);
    expect(lastData().features[0]?.properties).toEqual({ stale: true });

    rangeMark.measureFrom(undefined, false);
    expect(lastData().features.map((feature) => feature.geometry.type)).toEqual(["Point"]);
  });

  it("registers a tap target that outranks anything charted beneath it", () => {
    expect(registered).toHaveLength(1);
    expect(registered[0]?.layerId).toBe(RANGE_MARK_HIT_LAYER_ID);
    expect(registered[0]?.precedence).toBe(USER_MARK_FEATURE);
    expect(registered[0]?.render).toBeTypeOf("function");
  });

  it("clears the mark, its drawing and the readout from the popup's Remove button", () => {
    const readout = document.createElement("section");
    contextMenu?.({ lngLat: { lng: -90.81, lat: 46.81 } });
    rangeMark.measureFrom(position(46.7, -90.75), false);
    renderRangeBearing(readout, { mark: rangeMark.mark, position: position(46.7, -90.75), now: 1_000 });
    expect(readout.hidden).toBe(false);

    const panel = registered[0]?.render?.([{}]);
    const remove = panel?.querySelector("button");
    expect(remove).toBeInstanceOf(HTMLButtonElement);
    // Reachable by keyboard, because it is a real button rather than a div.
    expect(remove?.type).toBe("button");
    remove?.click();

    expect(rangeMark.mark).toBeUndefined();
    expect(lastData().features).toEqual([]);
    expect(changes.at(-1)).toBeUndefined();
    expect(dispatcher.closePopup).toHaveBeenCalled();

    renderRangeBearing(readout, { mark: rangeMark.mark, position: position(46.7, -90.75), now: 1_000 });
    expect(readout.hidden).toBe(true);
    expect(readout.textContent).toBe("");
  });

  it("ignores a removal when there is nothing to remove", () => {
    rangeMark.clear();
    expect(changes).toEqual([]);
  });

  it("stops listening for presses once disposed", () => {
    rangeMark.dispose();
    canvas.dispatchEvent(touch("pointerdown"));
    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS * 3);

    expect(rangeMark.mark).toBeUndefined();
  });
});
