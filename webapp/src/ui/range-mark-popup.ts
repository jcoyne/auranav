import { formatLatLng, type LatLng } from "../map/range-bearing";

export type RangeMarkPopupOptions = {
  readonly mark: LatLng;
  readonly onRemove: () => void;
};

/**
 * The panel shown when the user taps their own mark. Its only action is to
 * remove the mark, and it is a real `<button>` so it can be reached by
 * keyboard and announced as a control — a tappable `<div>` cannot.
 */
export function renderRangeMarkPopup(options: RangeMarkPopupOptions): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "mark-popup";

  const heading = document.createElement("strong");
  heading.textContent = "Range and bearing mark";

  const coordinates = document.createElement("span");
  coordinates.className = "mark-popup-coordinates";
  coordinates.textContent = formatLatLng(options.mark);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "mark-popup-remove";
  remove.textContent = "Remove mark";
  remove.addEventListener("click", () => options.onRemove());

  panel.append(heading, coordinates, remove);
  return panel;
}
