import { describe, expect, it, vi } from "vitest";
import { PositionTracker, mapPositionError, type PositionState } from "./position-tracker";

function mockGeolocation() {
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | undefined;
  const geolocation = {
    watchPosition: vi.fn((onSuccess: PositionCallback, onFailure: PositionErrorCallback) => {
      success = onSuccess;
      failure = onFailure;
      return 42;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } satisfies Geolocation;

  return {
    geolocation,
    succeed(position: GeolocationPosition) { success?.(position); },
    fail(error: GeolocationPositionError) { failure?.(error); },
  };
}

describe("PositionTracker", () => {
  it("reports unsupported browsers without starting a watch", () => {
    const states: PositionState[] = [];
    new PositionTracker(undefined, (state) => states.push(state)).start();
    expect(states).toEqual([{ kind: "unsupported" }]);
  });

  it("reports a fix and clears the active watch when stopped", () => {
    const fake = mockGeolocation();
    const states: PositionState[] = [];
    const tracker = new PositionTracker(fake.geolocation, (state) => states.push(state));
    const position = {
      coords: { latitude: 43, longitude: -87.9, accuracy: 12 },
      timestamp: 123,
    } as GeolocationPosition;

    tracker.start();
    fake.succeed(position);
    tracker.stop();

    expect(states).toEqual([
      { kind: "requesting" },
      { kind: "tracking", position },
      { kind: "idle" },
    ]);
    expect(fake.geolocation.clearWatch).toHaveBeenCalledWith(42);
    expect(tracker.isTracking).toBe(false);
  });

  it("does not leak the previous watch when restarted", () => {
    const fake = mockGeolocation();
    const tracker = new PositionTracker(fake.geolocation, vi.fn());
    tracker.start();
    tracker.start();
    expect(fake.geolocation.clearWatch).toHaveBeenCalledWith(42);
    expect(fake.geolocation.watchPosition).toHaveBeenCalledTimes(2);
  });

  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
    [99, "error"],
  ] as const)("maps geolocation error code %i to %s", (code, kind) => {
    expect(mapPositionError({ code, message: "failure" })).toEqual({ kind, message: "failure" });
  });
});
