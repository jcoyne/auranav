import type { LngLat, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { renderRangeMarkPopup } from "../ui/range-mark-popup";
import { USER_MARK_FEATURE } from "./feature-popup";
import { watchLongPress } from "./long-press";
import type { PopupDispatcher } from "./popup-dispatcher";
import type { LatLng } from "./range-bearing";
import {
  addRangeMarkLayer,
  RANGE_MARK_HIT_LAYER_ID,
  updateRangeMarkLayer,
} from "./range-mark-layer";

export type RangeMarkOptions = {
  readonly map: MapLibreMap;
  /** The application's one popup handler, so the mark outranks chart features. */
  readonly dispatcher: PopupDispatcher;
  /** Announces a placed or removed mark, so the readout can be redrawn. */
  readonly onChange: (mark: LatLng | undefined) => void;
};

/**
 * The single range-and-bearing mark the user can drop on the chart.
 *
 * There is at most one: a new long press moves it rather than building a
 * waypoint list. The mark is not persisted, so a reload clears it.
 *
 * This owns the mark itself, its layers, its popup and the gestures that place
 * it; the application supplies the position to measure from and draws the
 * readout.
 */
export class RangeMark {
  #mark: LatLng | undefined;
  #from: LatLng | undefined;
  #stale = false;
  readonly #map: MapLibreMap;
  readonly #dispatcher: PopupDispatcher;
  readonly #onChange: (mark: LatLng | undefined) => void;
  readonly #stopLongPress: () => void;

  constructor(options: RangeMarkOptions) {
    this.#map = options.map;
    this.#dispatcher = options.dispatcher;
    this.#onChange = options.onChange;

    addRangeMarkLayer(this.#map);
    this.#dispatcher.register({
      layerId: RANGE_MARK_HIT_LAYER_ID,
      peerPrefix: RANGE_MARK_HIT_LAYER_ID,
      precedence: USER_MARK_FEATURE,
      render: () => this.#popupContent(),
    });

    // Touch drops the mark by holding still; the desktop equivalent is the
    // context menu, which the long press suppresses when a platform
    // synthesises one from the same press.
    this.#stopLongPress = watchLongPress(this.#map.getCanvasContainer(), {
      onLongPress: (point) => this.place(this.#map.unproject([point.x, point.y])),
    });
    // MapLibre suppresses the browser's own menu for us once something
    // listens for `contextmenu`, so the right-click acts on the chart only.
    this.#map.on("contextmenu", (event: MapMouseEvent) => this.place(event.lngLat));
  }

  get mark(): LatLng | undefined {
    return this.#mark;
  }

  /** Places the mark, replacing any previous one. */
  place(at: LngLat | LatLng): void {
    this.#mark = toLatLng(at);
    // The open popup, if any, described the mark that has just moved away.
    this.#dispatcher.closePopup();
    this.#draw();
    this.#onChange(this.#mark);
  }

  clear(): void {
    if (this.#mark === undefined) return;
    this.#mark = undefined;
    this.#dispatcher.closePopup();
    this.#draw();
    this.#onChange(undefined);
  }

  /** Redraws the range line from a new fix. Call on every GPS update. */
  measureFrom(position: GeolocationPosition | undefined, stale: boolean): void {
    this.#from = position === undefined
      ? undefined
      : { latitude: position.coords.latitude, longitude: position.coords.longitude };
    this.#stale = stale;
    this.#draw();
  }

  dispose(): void {
    this.#stopLongPress();
  }

  #draw(): void {
    updateRangeMarkLayer(this.#map, {
      mark: this.#mark,
      from: this.#mark === undefined ? undefined : this.#from,
      stale: this.#stale,
    });
  }

  #popupContent(): HTMLElement {
    // The hit layer only carries a feature while a mark exists, so this is
    // reached with a mark in hand; the fallback keeps the types honest.
    const mark = this.#mark ?? { latitude: 0, longitude: 0 };
    return renderRangeMarkPopup({ mark, onRemove: () => this.clear() });
  }
}

function toLatLng(at: LngLat | LatLng): LatLng {
  return "lat" in at
    ? { latitude: at.lat, longitude: at.lng }
    : { latitude: at.latitude, longitude: at.longitude };
}
