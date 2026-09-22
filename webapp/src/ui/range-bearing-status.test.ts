import { describe, expect, it } from "vitest";
import { POSITION_STALE_AFTER_MS } from "./location-status";
import { renderRangeBearing } from "./range-bearing-status";

const MARK = { latitude: 46.7, longitude: -90.75 };

function position(timestamp: number): GeolocationPosition {
  return {
    coords: {
      latitude: 47.0828,
      longitude: -90.7289,
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

describe("range and bearing readout", () => {
  it("says nothing at all until a mark is placed", () => {
    const container = document.createElement("section");

    renderRangeBearing(container, { mark: undefined, position: position(1_000), now: 1_000 });

    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe("");
  });

  it("reports range in nautical miles and a bearing from a current fix", () => {
    const container = document.createElement("section");
    const fix = position(10_000);

    renderRangeBearing(container, { mark: MARK, position: fix, now: 10_000 });

    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain("23.0 NM");
    expect(container.textContent).toContain("182°");
    // No "current fix" badge: the location banner beneath already reports fix age.
    expect(container.textContent).not.toContain("Current fix");
    expect(container.querySelector(".range-bearing-fix-state")).toBeNull();
    expect(container.classList.contains("is-warning")).toBe(false);
    expect(container.classList.contains("is-stale")).toBe(false);
    expect(container.querySelector(".range-bearing-notice")).toBeNull();
  });

  it("says why there is no reading when there is no fix, rather than showing nothing", () => {
    const container = document.createElement("section");

    renderRangeBearing(container, { mark: MARK, position: undefined });

    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain("Range and bearing unavailable");
    expect(container.textContent).toContain("No fix");
    expect(container.querySelector(".range-bearing-notice")?.textContent)
      .toContain("Waiting for a GPS fix");
    expect(container.classList.contains("is-warning")).toBe(true);
  });

  it("passes on the reason the app already knows for a missing fix", () => {
    const container = document.createElement("section");

    renderRangeBearing(container, {
      mark: MARK,
      position: undefined,
      notice: "Location permission was denied.",
    });

    expect(container.querySelector(".range-bearing-notice")?.textContent)
      .toBe("Location permission was denied.");
  });

  it("marks a reading taken from a stale fix instead of presenting it as current", () => {
    const container = document.createElement("section");
    const fix = position(1_000);

    renderRangeBearing(container, {
      mark: MARK,
      position: fix,
      now: 1_000 + POSITION_STALE_AFTER_MS,
    });

    // The numbers are still shown, because a stale reading is better than a
    // blank one -- but it is labelled, so it cannot be read as live.
    expect(container.textContent).toContain("23.0 NM");
    expect(container.textContent).toContain("Stale fix");
    expect(container.querySelector(".range-bearing-notice")?.textContent)
      .toContain("stale");
    expect(container.classList.contains("is-stale")).toBe(true);
    expect(container.classList.contains("is-warning")).toBe(true);
  });

  it("honours a caller that already knows the fix has stopped updating", () => {
    const container = document.createElement("section");
    const fix = position(1_000);

    renderRangeBearing(container, {
      mark: MARK,
      position: fix,
      now: 1_000,
      forceStale: true,
      notice: "The location request timed out.",
    });

    expect(container.textContent).toContain("Stale fix");
    expect(container.querySelector(".range-bearing-notice")?.textContent)
      .toBe("The location request timed out.");
  });

  it("drops the warning state when a fresh fix follows a stale one", () => {
    const container = document.createElement("section");

    renderRangeBearing(container, { mark: MARK, position: position(1_000), now: 1_000 + POSITION_STALE_AFTER_MS });
    renderRangeBearing(container, { mark: MARK, position: position(90_000), now: 90_000 });

    expect(container.classList.contains("is-stale")).toBe(false);
    expect(container.classList.contains("is-warning")).toBe(false);
    expect(container.textContent).not.toContain("Stale fix");
    expect(container.querySelector(".range-bearing-fix-state")).toBeNull();
  });

  it("recomputes the range as the fix moves", () => {
    const container = document.createElement("section");
    const near = { ...position(1_000) };
    renderRangeBearing(container, { mark: MARK, position: near, now: 1_000 });
    const first = container.querySelector(".range-bearing-details")?.textContent;

    const moved: GeolocationPosition = {
      ...near,
      coords: { ...near.coords, latitude: 46.85 },
    };
    renderRangeBearing(container, { mark: MARK, position: moved, now: 1_000 });

    expect(container.querySelector(".range-bearing-details")?.textContent).not.toBe(first);
    expect(container.textContent).toContain("9.0");
  });
});
