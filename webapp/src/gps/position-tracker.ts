export type PositionState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "tracking"; position: GeolocationPosition }
  | { kind: "unsupported" }
  | { kind: "denied"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "error"; message: string };

export type PositionListener = (state: PositionState) => void;

const defaultOptions: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 15_000,
};

export class PositionTracker {
  readonly #geolocation: Geolocation | undefined;
  readonly #listener: PositionListener;
  #watchId: number | undefined;

  constructor(geolocation: Geolocation | undefined, listener: PositionListener) {
    this.#geolocation = geolocation;
    this.#listener = listener;
  }

  start(options: PositionOptions = defaultOptions): void {
    this.stop(false);

    if (!this.#geolocation) {
      this.#listener({ kind: "unsupported" });
      return;
    }

    this.#listener({ kind: "requesting" });
    this.#watchId = this.#geolocation.watchPosition(
      (position) => this.#listener({ kind: "tracking", position }),
      (error) => this.#listener(mapPositionError(error)),
      options,
    );
  }

  stop(announce = true): void {
    if (this.#geolocation && this.#watchId !== undefined) {
      this.#geolocation.clearWatch(this.#watchId);
      this.#watchId = undefined;
    }
    if (announce) this.#listener({ kind: "idle" });
  }

  get isTracking(): boolean {
    return this.#watchId !== undefined;
  }
}

export function mapPositionError(error: Pick<GeolocationPositionError, "code" | "message">): PositionState {
  switch (error.code) {
    case 1:
      return { kind: "denied", message: error.message };
    case 2:
      return { kind: "unavailable", message: error.message };
    case 3:
      return { kind: "timeout", message: error.message };
    default:
      return { kind: "error", message: error.message };
  }
}
