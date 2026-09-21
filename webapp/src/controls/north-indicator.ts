export type RotatableMap = {
  getBearing(): number;
  resetNorth(): void;
  on(type: "rotate", listener: () => void): unknown;
};

// A rotated map reads as north-up until you notice otherwise, which is exactly the mistake
// worth guarding against on a chart. Bearings within this much of north are reported as north
// so a stray touch-gesture fraction of a degree does not claim the map is rotated.
const NORTH_TOLERANCE_DEGREES = 0.5;

const NEEDLE_MARKUP = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <polygon points="12,2.5 8.6,13 15.4,13" fill="#c0392b" />
    <polygon points="8.6,13 15.4,13 12,21.5" fill="#6b818c" />
  </svg>
`;

/**
 * A compass needle that keeps pointing at true north however the map is rotated, and returns
 * the map to north-up when activated.
 */
export class NorthIndicator {
  readonly #map: RotatableMap;
  readonly #button: HTMLButtonElement;
  readonly #needle: SVGElement;
  /**
   * The needle's accumulated angle, deliberately not wrapped to 0–360. CSS interpolates
   * `rotate()` numerically, so wrapping would send the needle the long way round whenever the
   * bearing crosses north — 300° to 10° would sweep back through south instead of through north.
   */
  #rotation = 0;

  constructor(container: HTMLElement, map: RotatableMap) {
    this.#map = map;
    this.#button = document.createElement("button");
    this.#button.type = "button";
    this.#button.className = "north-button";
    this.#button.innerHTML = NEEDLE_MARKUP;
    const needle = this.#button.querySelector("svg");
    if (!needle) throw new Error("Compass needle markup is missing its SVG root");
    this.#needle = needle;

    this.#button.addEventListener("click", () => map.resetNorth());
    map.on("rotate", () => this.render());
    container.append(this.#button);
    this.render();
  }

  render(): void {
    const bearing = normalizeBearing(this.#map.getBearing());
    const isNorthUp = bearing <= NORTH_TOLERANCE_DEGREES || bearing >= 360 - NORTH_TOLERANCE_DEGREES;
    // The map turns under the needle: at a bearing of 90° east is up, so north lies to the left.
    this.#rotation += shortestTurn(this.#rotation, -bearing);
    this.#needle.style.transform = `rotate(${round(this.#rotation)}deg)`;
    this.#button.classList.toggle("is-north-up", isNorthUp);
    const label = isNorthUp
      ? "Map is oriented north up"
      : `Map rotated ${Math.round(bearing)}°. Reset to north up.`;
    this.#button.setAttribute("aria-label", label);
    this.#button.title = label;
  }
}

function normalizeBearing(bearing: number): number {
  if (!Number.isFinite(bearing)) return 0;
  return ((bearing % 360) + 360) % 360;
}

/** The signed turn from one angle to an equivalent of the other, never more than half a circle. */
function shortestTurn(from: number, to: number): number {
  const turn = (to - from) % 360;
  if (turn > 180) return turn - 360;
  if (turn < -180) return turn + 360;
  return turn;
}

function round(degrees: number): number {
  return Math.round(degrees * 100) / 100;
}
