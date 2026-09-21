import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TRACK_POINTS,
  SEGMENT_GAP_MS,
  appendTrackPoint,
  clearStoredTrack,
  emptyTrack,
  readTrack,
  startTrackSegment,
  trackDistanceMetres,
  trackPointCount,
  trackToGeoJson,
  writeTrack,
  type Track,
  type TrackPoint,
} from "./track-store";

function point(longitude: number, latitude: number, time: number): TrackPoint {
  return { longitude, latitude, time };
}

/** About 30 m of easting at 43° N, comfortably past the jitter filter. */
function eastOf(previous: TrackPoint, seconds: number): TrackPoint {
  return point(previous.longitude + 0.0004, previous.latitude, previous.time + seconds * 1000);
}

describe("track store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty and appends fixes to one polyline", () => {
    let track = emptyTrack();
    const first = point(-87.9, 43, 1_000);
    track = appendTrackPoint(track, first);
    track = appendTrackPoint(track, eastOf(first, 15));

    expect(track.segments).toHaveLength(1);
    expect(trackPointCount(track)).toBe(2);
  });

  it("ignores a fix that has barely moved so a moored boat does not fill storage", () => {
    const first = point(-87.9, 43, 1_000);
    const track = appendTrackPoint(emptyTrack(), first);
    const jittered = appendTrackPoint(track, point(-87.900001, 43.000001, 16_000));

    expect(jittered).toBe(track);
    expect(trackPointCount(jittered)).toBe(1);
  });

  it("rejects a fix with non-finite or out-of-range coordinates", () => {
    const track = appendTrackPoint(emptyTrack(), point(-87.9, 43, 1_000));
    expect(appendTrackPoint(track, point(Number.NaN, 43, 20_000))).toBe(track);
    expect(appendTrackPoint(track, point(-87.8, 91, 20_000))).toBe(track);
    expect(appendTrackPoint(track, point(-87.8, 43, Number.POSITIVE_INFINITY))).toBe(track);
  });

  it("breaks the line into a new polyline after a gap in fixes", () => {
    const first = point(-87.9, 43, 1_000);
    let track = appendTrackPoint(emptyTrack(), first);
    const second = eastOf(first, 15);
    track = appendTrackPoint(track, second);
    track = appendTrackPoint(track, eastOf(second, SEGMENT_GAP_MS / 1000));

    expect(track.segments.map((segment) => segment.length)).toEqual([2, 1]);
  });

  it("breaks the line when the clock jumps backwards rather than inventing a leg", () => {
    const first = point(-87.9, 43, 60_000);
    let track = appendTrackPoint(emptyTrack(), first);
    track = appendTrackPoint(track, point(-87.8, 43, 10_000));

    expect(track.segments.map((segment) => segment.length)).toEqual([1, 1]);
  });

  it("starts a new polyline when recording resumes", () => {
    const first = point(-87.9, 43, 1_000);
    let track = appendTrackPoint(emptyTrack(), first);
    track = startTrackSegment(track);
    track = appendTrackPoint(track, eastOf(first, 5));

    expect(track.segments.map((segment) => segment.length)).toEqual([1, 1]);
  });

  it("does not stack empty segments when recording is toggled without a fix", () => {
    const track = startTrackSegment(startTrackSegment(appendTrackPoint(emptyTrack(), point(-87.9, 43, 1))));
    expect(track.segments).toHaveLength(2);
  });

  it("drops the oldest points once the cap is reached and reports the trim", () => {
    let track = emptyTrack();
    let previous = point(-87.9, 43, 0);
    track = appendTrackPoint(track, previous);
    for (let index = 1; index <= MAX_TRACK_POINTS; index += 1) {
      previous = point(-87.9 + index * 0.0004, 43, index * 15_000);
      track = appendTrackPoint(track, previous);
    }

    expect(trackPointCount(track)).toBe(MAX_TRACK_POINTS);
    expect(track.trimmed).toBe(true);
    // The first fix was discarded; the newest is still the most recent one appended.
    expect(track.segments[0]?.[0]?.time).toBe(15_000);
    expect(track.segments.at(-1)?.at(-1)).toEqual(previous);
  });

  it("measures distance along every polyline", () => {
    const first = point(-87.9, 43, 0);
    let track = appendTrackPoint(emptyTrack(), first);
    track = appendTrackPoint(track, point(-87.9, 43.0089932, 15_000));

    // One thousandth of a degree of latitude is about 111 m; 0.0089932° is about 1 km.
    expect(trackDistanceMetres(track)).toBeGreaterThan(990);
    expect(trackDistanceMetres(track)).toBeLessThan(1010);
    expect(trackDistanceMetres(emptyTrack())).toBe(0);
  });

  it("renders polylines as GeoJSON and skips segments too short to draw", () => {
    const first = point(-87.9, 43, 1_000);
    let track = appendTrackPoint(emptyTrack(), first);
    track = appendTrackPoint(track, eastOf(first, 15));
    track = startTrackSegment(track);
    track = appendTrackPoint(track, point(-87.5, 43.2, 200_000));

    const collection = trackToGeoJson(track);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.geometry.coordinates).toHaveLength(2);
    expect(collection.features[0]?.geometry.coordinates[0]).toEqual([-87.9, 43]);
  });

  it("round-trips a stored track", () => {
    const first = point(-87.912345, 43.056789, 1_700_000_000_000);
    let track = appendTrackPoint(emptyTrack(), first);
    track = appendTrackPoint(track, eastOf(first, 15));

    expect(writeTrack(track)).toBe(true);
    expect(readTrack()).toEqual(track);
  });

  it("stores coordinates rounded to about a tenth of a metre", () => {
    writeTrack({ segments: [[point(-87.91234567891, 43.0000000001, 5.6)]], trimmed: false });
    expect(readTrack().segments[0]?.[0]).toEqual({ longitude: -87.912346, latitude: 43, time: 6 });
  });

  it("returns an empty track for missing, malformed, or foreign storage", () => {
    expect(readTrack()).toEqual(emptyTrack());

    localStorage.setItem("chartplotter.track.v1", "not json");
    expect(readTrack()).toEqual(emptyTrack());

    localStorage.setItem("chartplotter.track.v1", JSON.stringify({ version: 2, segments: [[[1, 2, 3]]] }));
    expect(readTrack()).toEqual(emptyTrack());
  });

  it("keeps the readable points from a partly corrupted track", () => {
    localStorage.setItem("chartplotter.track.v1", JSON.stringify({
      version: 1,
      trimmed: true,
      segments: [[[-87.9, 43, 1], ["x", 43, 2], [-87.8, 999, 3], [-87.8, 43, 4]], "nope", []],
    }));

    const track = readTrack();
    expect(track.trimmed).toBe(true);
    expect(track.segments).toHaveLength(1);
    expect(track.segments[0]).toEqual([point(-87.9, 43, 1), point(-87.8, 43, 4)]);
  });

  it("reports a refused write instead of throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(writeTrack(emptyTrack())).toBe(false);
  });

  it("clears stored points", () => {
    const track: Track = { segments: [[point(-87.9, 43, 1)]], trimmed: false };
    writeTrack(track);
    clearStoredTrack();
    expect(readTrack()).toEqual(emptyTrack());
  });
});
