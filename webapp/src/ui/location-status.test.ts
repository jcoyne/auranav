import { describe, expect, it } from "vitest";
import {
  POSITION_STALE_AFTER_MS,
  isPositionStale,
  millisecondsUntilPositionStale,
  renderLocationMessage,
  renderPositionStatus,
} from "./location-status";

function position(timestamp: number, accuracy = 12.4): GeolocationPosition {
  return {
    coords: {
      latitude: 43.123456,
      longitude: -87.987654,
      accuracy,
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

describe("location status", () => {
  it("hides the banner when it has nothing to say", () => {
    const container = document.createElement("section");

    renderLocationMessage(container, "Requesting your location…");
    expect(container.hidden).toBe(false);

    renderLocationMessage(container, "");
    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe("");

    renderPositionStatus(container, position(Date.now()), "following");
    expect(container.hidden).toBe(false);
  });

  it("displays coordinates, reported accuracy, timestamp, and a current fix", () => {
    const container = document.createElement("section");
    const fix = position(Date.UTC(2026, 8, 18, 12, 0, 0));

    renderPositionStatus(container, fix, "following", fix.timestamp + 5_000);

    expect(container.textContent).toContain("43.12346° N, 87.98765° W");
    expect(container.textContent).toContain("Accuracy ±12 m");
    expect(container.textContent).toContain("Fix ");
    expect(container.textContent).toContain("Current fix");
    expect(container.textContent).toContain("Following");
    expect(container.querySelector(".location-details")?.getAttribute("title"))
      .toBe("2026-09-18T12:00:00.000Z");
    expect(container.classList.contains("is-stale")).toBe(false);
  });

  it("changes between current and stale states at the freshness threshold", () => {
    const container = document.createElement("section");
    const fix = position(1_000);

    expect(isPositionStale(fix, 1_000 + POSITION_STALE_AFTER_MS - 1)).toBe(false);
    expect(millisecondsUntilPositionStale(fix, 1_000 + POSITION_STALE_AFTER_MS - 1)).toBe(1);

    renderPositionStatus(container, fix, "paused", 1_000 + POSITION_STALE_AFTER_MS);

    expect(isPositionStale(fix, 1_000 + POSITION_STALE_AFTER_MS)).toBe(true);
    expect(millisecondsUntilPositionStale(fix, 1_000 + POSITION_STALE_AFTER_MS)).toBe(0);
    expect(container.textContent).toContain("Stale fix");
    expect(container.textContent).toContain("Follow off");
    expect(container.classList.contains("is-stale")).toBe(true);

    const newFix = position(1_000 + POSITION_STALE_AFTER_MS);
    renderPositionStatus(container, newFix, "following", newFix.timestamp);
    expect(container.textContent).toContain("Current fix");
    expect(container.classList.contains("is-stale")).toBe(false);
  });

  it("reports unusable accuracy instead of displaying NaN", () => {
    const container = document.createElement("section");

    renderPositionStatus(container, position(1_000, Number.NaN), "following", 2_000);

    expect(container.textContent).toContain("Accuracy unavailable");
    expect(container.textContent).not.toContain("NaN");
  });

  it("limits the stale timer when a device reports a future timestamp", () => {
    const now = 10_000;
    const futureFix = position(now + 60 * 60 * 1_000);

    expect(millisecondsUntilPositionStale(futureFix, now)).toBe(POSITION_STALE_AFTER_MS);
  });

  it("retains fix details but marks them stale when updates stop with an error", () => {
    const container = document.createElement("section");
    const fix = position(10_000);

    renderPositionStatus(container, fix, "paused", 11_000, {
      forceStale: true,
      notice: "A GPS position is currently unavailable.",
    });

    expect(container.textContent).toContain("43.12346° N, 87.98765° W");
    expect(container.textContent).toContain("Accuracy ±12 m");
    expect(container.textContent).toContain("Stale fix");
    expect(container.textContent).toContain("A GPS position is currently unavailable.");
    expect(container.classList.contains("is-warning")).toBe(true);
  });
});
