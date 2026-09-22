import { formatLatLng } from "../map/range-bearing";

export const POSITION_STALE_AFTER_MS = 30_000;

export type FollowState = "following" | "paused";

type PositionStatusOptions = {
  forceStale?: boolean;
  notice?: string;
};

export function isPositionStale(position: GeolocationPosition, now = Date.now()): boolean {
  return !Number.isFinite(position.timestamp)
    || now - position.timestamp >= POSITION_STALE_AFTER_MS;
}

export function millisecondsUntilPositionStale(
  position: GeolocationPosition,
  now = Date.now(),
): number {
  if (!Number.isFinite(position.timestamp)) return 0;
  return Math.min(
    POSITION_STALE_AFTER_MS,
    Math.max(0, position.timestamp + POSITION_STALE_AFTER_MS - now),
  );
}

export function renderPositionStatus(
  container: HTMLElement,
  position: GeolocationPosition,
  followState: FollowState,
  now = Date.now(),
  options: PositionStatusOptions = {},
): void {
  const stale = options.forceStale === true || isPositionStale(position, now);
  const coordinates = formatLatLng({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  });
  // The ± is what makes this an accuracy figure; the word adds nothing.
  const accuracy = Number.isFinite(position.coords.accuracy)
    ? `±${Math.round(Math.max(0, position.coords.accuracy))} m`
    : "Accuracy unavailable";
  const fixTime = new Date(position.timestamp);
  const timestamp = Number.isNaN(fixTime.valueOf())
    ? "Time unavailable"
    : `Fix ${fixTime.toLocaleTimeString()}`;

  container.replaceChildren();
  const details = document.createElement("span");
  details.className = "location-details";
  details.textContent = `${coordinates} · ${accuracy} · ${timestamp}`;
  if (!Number.isNaN(fixTime.valueOf())) details.title = fixTime.toISOString();

  const state = document.createElement("span");
  state.className = `location-fix-state ${stale ? "is-stale" : "is-current"}`;
  state.textContent = stale ? "Stale fix" : "Current fix";

  const follow = document.createElement("span");
  follow.className = "location-follow-state";
  follow.textContent = followState === "following" ? "Following" : "Follow off";

  container.append(details, state, follow);
  if (options.notice) {
    const notice = document.createElement("span");
    notice.className = "location-update-state";
    notice.textContent = options.notice;
    container.append(notice);
  }
  container.classList.toggle("is-warning", options.notice !== undefined);
  container.classList.toggle("is-stale", stale);
  container.hidden = false;
}

export function renderLocationMessage(
  container: HTMLElement,
  message: string,
  warning = false,
): void {
  container.textContent = message;
  container.classList.toggle("is-warning", warning);
  container.classList.remove("is-stale");
  container.hidden = message.length === 0;
}
