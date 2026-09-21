import type { Feature, FeatureCollection, LineString } from "geojson";

const STORAGE_KEY = "chartplotter.track.v1";

/**
 * Roughly 80 hours of recording at one sample every 15 seconds, and about 600 KB of JSON --
 * well inside a 5 MB localStorage budget shared with the chart settings. Older points are
 * dropped rather than refusing to record, so a long trip never silently stops logging.
 */
export const MAX_TRACK_POINTS = 20_000;

/** A gap this long between fixes breaks the line rather than drawing a leg the boat never sailed. */
export const SEGMENT_GAP_MS = 60_000;

/** GPS jitter while moored would otherwise fill storage with a scribble. */
export const MIN_POINT_SEPARATION_METRES = 2;

export type TrackPoint = {
  longitude: number;
  latitude: number;
  /** Fix time in epoch milliseconds, taken from the GPS position rather than the wall clock. */
  time: number;
};

/** One polyline per continuous run of fixes. Recording off and on starts a new one. */
export type Track = {
  segments: TrackPoint[][];
  /** True once the oldest points have been discarded to stay under {@link MAX_TRACK_POINTS}. */
  trimmed: boolean;
};

export function emptyTrack(): Track {
  return { segments: [], trimmed: false };
}

export function readTrack(): Track {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyTrack();
    return parseTrack(JSON.parse(raw));
  } catch {
    return emptyTrack();
  }
}

/** Returns false when the browser refuses the write, so the caller can tell the user. */
export function writeTrack(track: Track): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeTrack(track)));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredTrack(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A browser that refuses storage has nothing stored to remove.
  }
}

/**
 * Appends a fix, returning the original track unchanged when the point adds nothing --
 * the caller uses that identity to skip a needless write and redraw.
 */
export function appendTrackPoint(track: Track, point: TrackPoint): Track {
  if (!isFinitePoint(point)) return track;

  const lastSegment = track.segments.at(-1);
  const previous = lastSegment?.at(-1);

  if (!lastSegment || (previous && breaksSegment(previous, point))) {
    return trimTrack({ segments: [...track.segments, [point]], trimmed: track.trimmed });
  }
  if (previous && distanceMetres(previous, point) < MIN_POINT_SEPARATION_METRES) return track;

  const segments = track.segments.slice(0, -1);
  segments.push([...lastSegment, point]);
  return trimTrack({ segments, trimmed: track.trimmed });
}

/** Starts a new polyline, so a pause in recording is not drawn as a straight leg. */
export function startTrackSegment(track: Track): Track {
  if (track.segments.length === 0 || track.segments.at(-1)?.length === 0) return track;
  return { segments: [...track.segments, []], trimmed: track.trimmed };
}

export function trackPointCount(track: Track): number {
  return track.segments.reduce((total, segment) => total + segment.length, 0);
}

export function trackDistanceMetres(track: Track): number {
  let total = 0;
  for (const segment of track.segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const from = segment[index - 1];
      const to = segment[index];
      if (from && to) total += distanceMetres(from, to);
    }
  }
  return total;
}

/** Single-point segments carry no line geometry, so they are left out of the drawn collection. */
export function trackToGeoJson(track: Track): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = track.segments
    .filter((segment) => segment.length >= 2)
    .map((segment, index) => ({
      type: "Feature",
      properties: {
        segment: index,
        startTime: segment[0]?.time ?? null,
        endTime: segment.at(-1)?.time ?? null,
      },
      geometry: {
        type: "LineString",
        coordinates: segment.map((point) => [point.longitude, point.latitude]),
      },
    }));
  return { type: "FeatureCollection", features };
}

function breaksSegment(previous: TrackPoint, point: TrackPoint): boolean {
  // A backwards clock jump is treated as a break too: the elapsed time is unknowable,
  // so joining the points would assert a leg that may not have been sailed.
  return point.time < previous.time || point.time - previous.time >= SEGMENT_GAP_MS;
}

function trimTrack(track: Track): Track {
  let excess = trackPointCount(track) - MAX_TRACK_POINTS;
  if (excess <= 0) return track;

  const segments: TrackPoint[][] = [];
  for (const segment of track.segments) {
    if (segment.length > 0 && excess >= segment.length) {
      excess -= segment.length;
      continue;
    }
    segments.push(excess > 0 ? segment.slice(excess) : segment);
    excess = 0;
  }
  return { segments, trimmed: true };
}

function distanceMetres(from: TrackPoint, to: TrackPoint): number {
  const earthRadiusMetres = 6_371_008.8;
  const fromLatitude = from.latitude * Math.PI / 180;
  const toLatitude = to.latitude * Math.PI / 180;
  const deltaLatitude = toLatitude - fromLatitude;
  const deltaLongitude = (to.longitude - from.longitude) * Math.PI / 180;
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isFinitePoint(point: TrackPoint): boolean {
  return Number.isFinite(point.longitude)
    && Number.isFinite(point.latitude)
    && Number.isFinite(point.time)
    && Math.abs(point.latitude) <= 90
    && Math.abs(point.longitude) <= 180;
}

type SerializedTrack = {
  version: 1;
  trimmed: boolean;
  /** `[longitude, latitude, time]` triples: about a third of the bytes of named keys. */
  segments: [number, number, number][][];
};

function serializeTrack(track: Track): SerializedTrack {
  return {
    version: 1,
    trimmed: track.trimmed,
    segments: track.segments
      .filter((segment) => segment.length > 0)
      // Six decimal places is about 0.1 m, finer than any consumer GPS fix.
      .map((segment) => segment.map((point) => [
        round(point.longitude),
        round(point.latitude),
        Math.round(point.time),
      ])),
  };
}

/** Storage is user-editable and survives app upgrades, so anything malformed is discarded. */
function parseTrack(value: unknown): Track {
  if (typeof value !== "object" || value === null) return emptyTrack();
  const stored = value as Partial<SerializedTrack>;
  if (stored.version !== 1 || !Array.isArray(stored.segments)) return emptyTrack();

  const segments: TrackPoint[][] = [];
  for (const segment of stored.segments) {
    if (!Array.isArray(segment)) continue;
    const points: TrackPoint[] = [];
    for (const entry of segment) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const [longitude, latitude, time] = entry;
      if (typeof longitude !== "number" || typeof latitude !== "number" || typeof time !== "number") continue;
      const point = { longitude, latitude, time };
      if (isFinitePoint(point)) points.push(point);
    }
    if (points.length > 0) segments.push(points);
  }
  return { segments, trimmed: stored.trimmed === true };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
