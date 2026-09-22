import { groundResolutionMetresPerPixel } from "../map/chart-scale";
import { METRES_PER_NAUTICAL_MILE } from "../map/range-bearing";

const METRES_PER_FOOT = 0.3048;

/**
 * Lengths a scale bar is allowed to take, shortest first. Nautical miles are the
 * unit the rest of the app measures in, but a bar is a few centimetres long, and
 * at harbour zooms that is a couple of hundred feet. Feet carry the short end
 * rather than printing a nautical mile with three decimals nobody can read off a
 * bar. Depths already display in feet, so the two agree.
 */
const SCALE_STEPS: readonly { readonly metres: number; readonly label: string }[] = [
  ...[50, 100, 200, 500, 1000, 2000].map((feet) => ({
    metres: feet * METRES_PER_FOOT,
    label: `${feet} ft`,
  })),
  ...[0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].map((miles) => ({
    metres: miles * METRES_PER_NAUTICAL_MILE,
    label: `${miles} NM`,
  })),
];

export type ScaleBarReading = {
  readonly label: string;
  readonly lengthPx: number;
};

/**
 * The longest allowed length that still fits the space, so the bar grows as you
 * zoom in and drops to the next value down rather than stretching indefinitely.
 * Below the shortest step the bar keeps that step and simply overflows the
 * budget, which only happens past the app's maximum zoom.
 */
export function chooseScaleBar(metresPerPixel: number, maxLengthPx: number): ScaleBarReading | undefined {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return undefined;
  if (!Number.isFinite(maxLengthPx) || maxLengthPx <= 0) return undefined;
  const budget = maxLengthPx * metresPerPixel;
  const step = [...SCALE_STEPS].reverse().find((candidate) => candidate.metres <= budget)
    ?? SCALE_STEPS[0];
  if (step === undefined) return undefined;
  return { label: step.label, lengthPx: step.metres / metresPerPixel };
}

export type ScalableMap = {
  getZoom(): number;
  getCenter(): { lat: number };
  on(type: "move", listener: () => void): unknown;
};

/** A scale bar that restates its length whenever the map moves or zooms. */
export class ScaleBar {
  readonly #map: ScalableMap;
  readonly #element: HTMLElement;
  readonly #bar: HTMLElement;
  readonly #label: HTMLElement;
  readonly #maxLengthPx: number;

  constructor(container: HTMLElement, map: ScalableMap, maxLengthPx = 184) {
    this.#map = map;
    this.#element = container;
    this.#maxLengthPx = maxLengthPx;
    container.replaceChildren();

    this.#label = document.createElement("span");
    this.#label.className = "scale-bar-label";
    this.#bar = document.createElement("span");
    this.#bar.className = "scale-bar-rule";
    container.append(this.#label, this.#bar);

    map.on("move", () => this.update());
    this.update();
  }

  update(): void {
    const reading = chooseScaleBar(
      groundResolutionMetresPerPixel(this.#map.getZoom(), this.#map.getCenter().lat),
      this.#maxLengthPx,
    );
    if (reading === undefined) {
      this.#element.hidden = true;
      return;
    }
    this.#element.hidden = false;
    this.#label.textContent = reading.label;
    // The bar runs vertically, so its length is a height.
    this.#bar.style.height = `${Math.round(reading.lengthPx)}px`;
  }
}
