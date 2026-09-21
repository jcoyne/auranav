import { isPositionStale } from "../ui/location-status";
import {
  appendTrackPoint,
  clearStoredTrack,
  emptyTrack,
  readTrack,
  startTrackSegment,
  writeTrack,
  type Track,
} from "./track-store";

export const SAMPLE_INTERVAL_MS = 15_000;

export type TrackRecorderState = {
  recording: boolean;
  track: Track;
  /** True when the last save was refused (private mode, quota); the line is still drawn. */
  storageFailed: boolean;
};

export type TrackRecorderOptions = {
  onChange(state: TrackRecorderState): void;
  intervalMs?: number;
};

/**
 * Samples the most recent GPS fix on a fixed interval rather than recording every
 * `watchPosition` callback: the sample rate then stays predictable no matter how chatty
 * the receiver is, and a stationary boat does not fill storage with jitter.
 */
export class TrackRecorder {
  readonly #onChange: (state: TrackRecorderState) => void;
  readonly #intervalMs: number;
  #track: Track;
  #recording = false;
  #storageFailed = false;
  #latest: GeolocationPosition | undefined;
  #timer: number | undefined;

  constructor(options: TrackRecorderOptions) {
    this.#onChange = options.onChange;
    this.#intervalMs = options.intervalMs ?? SAMPLE_INTERVAL_MS;
    this.#track = readTrack();
  }

  get isRecording(): boolean {
    return this.#recording;
  }

  get state(): TrackRecorderState {
    return { recording: this.#recording, track: this.#track, storageFailed: this.#storageFailed };
  }

  start(): void {
    if (this.#recording) return;
    this.#recording = true;
    this.#track = startTrackSegment(this.#track);
    this.#timer = window.setInterval(() => this.#sample(), this.#intervalMs);
    // Record straight away when a fix is already in hand, so the first leg is not
    // missing its first 15 seconds.
    if (!this.#sample()) this.#onChange(this.state);
  }

  stop(): void {
    if (!this.#recording) return;
    this.#recording = false;
    this.#clearTimer();
    this.#onChange(this.state);
  }

  /** Hands the recorder the latest fix; it decides whether this is a sample time. */
  positionUpdated(position: GeolocationPosition): void {
    const first = this.#latest === undefined;
    this.#latest = position;
    // The first fix after recording starts is worth keeping immediately; later fixes wait
    // for the interval.
    if (this.#recording && first) this.#sample();
  }

  /** Forgets the cached fix so a resumed recording does not log a position from an old session. */
  positionLost(): void {
    this.#latest = undefined;
  }

  clear(): void {
    this.#track = emptyTrack();
    this.#storageFailed = false;
    clearStoredTrack();
    this.#onChange(this.state);
  }

  /** Returns true when a point was added. */
  #sample(): boolean {
    const position = this.#latest;
    if (!this.#recording || !position) return false;
    // A stale fix would draw a leg to where the boat used to be.
    if (isPositionStale(position)) return false;

    const next = appendTrackPoint(this.#track, {
      longitude: position.coords.longitude,
      latitude: position.coords.latitude,
      time: position.timestamp,
    });
    if (next === this.#track) return false;

    this.#track = next;
    this.#storageFailed = !writeTrack(next);
    this.#onChange(this.state);
    return true;
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    window.clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

