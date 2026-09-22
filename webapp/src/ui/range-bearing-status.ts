import {
  formatBearing,
  formatLatLng,
  formatRange,
  type LatLng,
  rangeNauticalMiles,
  trueBearingDegrees,
} from "../map/range-bearing";
import { isPositionStale } from "./location-status";

export type RangeBearingOptions = {
  /** The mark the reading is to. Without one there is nothing to report. */
  readonly mark: LatLng | undefined;
  /** The position the reading is from. */
  readonly position: GeolocationPosition | undefined;
  readonly now?: number;
  /** Treats the fix as stale even if its timestamp is recent. */
  readonly forceStale?: boolean;
  /** Why the fix is missing or untrustworthy, when the app already knows. */
  readonly notice?: string;
};

const NO_FIX_NOTICE = "Waiting for a GPS fix. Turn on location to measure to the mark.";
const STALE_NOTICE = "Measured from the last GPS fix, which is stale — not your position now.";

/**
 * The range and bearing readout for the user's mark.
 *
 * A mark with no usable fix says so rather than showing nothing, and a reading
 * taken from a stale fix is labelled as such rather than presented as current:
 * a range that has quietly stopped updating is worse than no range at all.
 */
export function renderRangeBearing(container: HTMLElement, options: RangeBearingOptions): void {
  const { mark, position } = options;
  container.replaceChildren();
  container.classList.remove("is-warning", "is-stale");

  if (mark === undefined) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const label = document.createElement("span");
  label.className = "range-bearing-label";
  label.textContent = "Mark";
  label.title = formatLatLng(mark);

  const details = document.createElement("span");
  details.className = "range-bearing-details";

  const state = document.createElement("span");
  state.className = "range-bearing-fix-state";

  if (position === undefined) {
    details.textContent = "Range and bearing unavailable";
    state.classList.add("is-missing");
    state.textContent = "No fix";
    container.classList.add("is-warning");
    container.append(label, details, state, noticeElement(options.notice ?? NO_FIX_NOTICE));
    return;
  }

  const from: LatLng = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
  const stale = options.forceStale === true || isPositionStale(position, options.now ?? Date.now());
  details.textContent = `${formatRange(rangeNauticalMiles(from, mark))} · ${formatBearing(trueBearingDegrees(from, mark))}`;
  details.title = `Mark ${formatLatLng(mark)}`;

  state.classList.add(stale ? "is-stale" : "is-current");
  state.textContent = stale ? "Stale fix" : "Current fix";

  container.append(label, details, state);
  if (!stale) return;

  container.classList.add("is-warning", "is-stale");
  container.append(noticeElement(options.notice ?? STALE_NOTICE));
}

function noticeElement(message: string): HTMLElement {
  const notice = document.createElement("span");
  notice.className = "range-bearing-notice";
  notice.textContent = message;
  return notice;
}
