import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_INTERVAL_MS, TrackRecorder, type TrackRecorderState } from "./track-recorder";
import { readTrack, trackPointCount, writeTrack } from "./track-store";

function fixAt(longitude: number, time: number): GeolocationPosition {
  return {
    coords: {
      latitude: 43,
      longitude,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: time,
    toJSON: () => ({}),
  };
}

/** Coordinates far enough apart that the store's jitter filter keeps every fix. */
function fix(index: number): GeolocationPosition {
  return fixAt(-87.9 + index * 0.0004, Date.now());
}

describe("track recorder", () => {
  let states: TrackRecorderState[];

  function recorder(): TrackRecorder {
    return new TrackRecorder({ onChange: (state) => states.push(state) });
  }

  beforeEach(() => {
    localStorage.clear();
    states = [];
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records nothing until recording starts", () => {
    const track = recorder();
    track.positionUpdated(fix(0));
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS * 4);

    expect(track.isRecording).toBe(false);
    expect(trackPointCount(track.state.track)).toBe(0);
    expect(readTrack().segments).toHaveLength(0);
  });

  it("samples the latest fix once per interval and persists each point", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));

    // A receiver reports far more often than the sample interval; only one fix per
    // interval is kept, plus the one recorded when recording started.
    for (let index = 1; index <= 9; index += 1) {
      vi.advanceTimersByTime(SAMPLE_INTERVAL_MS / 3);
      track.positionUpdated(fix(index));
    }

    expect(trackPointCount(track.state.track)).toBe(4);
    expect(trackPointCount(readTrack())).toBe(4);
  });

  it("records the first fix immediately rather than waiting out the interval", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));

    expect(trackPointCount(track.state.track)).toBe(1);
  });

  it("ignores extra fixes that arrive between samples", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));
    track.positionUpdated(fix(1));
    track.positionUpdated(fix(2));

    expect(trackPointCount(track.state.track)).toBe(1);
  });

  it("stops sampling when recording is turned off", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));
    track.stop();

    for (let index = 1; index <= 4; index += 1) {
      vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);
      track.positionUpdated(fix(index));
    }

    expect(track.isRecording).toBe(false);
    expect(trackPointCount(track.state.track)).toBe(1);
  });

  it("keeps the recorded points and starts a new polyline when recording resumes", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));
    track.stop();
    track.start();
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);
    track.positionUpdated(fix(1));

    expect(track.state.track.segments.map((segment) => segment.length)).toEqual([1, 1]);
  });

  it("does not record a stale fix", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fixAt(-87.9, Date.now() - 45_000));
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS);

    expect(trackPointCount(track.state.track)).toBe(0);
  });

  it("resumes the stored track from a previous session", () => {
    writeTrack({ segments: [[{ longitude: -87.9, latitude: 43, time: 1 }]], trimmed: false });

    expect(trackPointCount(recorder().state.track)).toBe(1);
  });

  it("reports a refused save while still drawing the line", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));

    expect(track.state.storageFailed).toBe(true);
    expect(trackPointCount(track.state.track)).toBe(1);
  });

  it("clears the track in memory and in storage", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));
    track.clear();

    expect(trackPointCount(track.state.track)).toBe(0);
    expect(readTrack().segments).toHaveLength(0);
    expect(states.at(-1)?.recording).toBe(true);
  });

  it("announces every change so the drawer and the chart stay in step", () => {
    const track = recorder();
    track.start();
    track.positionUpdated(fix(0));
    track.stop();

    expect(states.map((state) => [state.recording, trackPointCount(state.track)]))
      .toEqual([[true, 0], [true, 1], [false, 1]]);
  });
});
