const STORAGE_KEY = "chartplotter.map-settings.v1";

export type MapSettings = {
  /**
   * Off by default: touch and mouse gestures already pan and zoom, and on a phone the
   * on-screen pad covers chart the user is trying to read. Keyboard pan and zoom stay
   * available through MapLibre's own arrow and +/- handling either way.
   */
  showPanZoomButtons: boolean;
  /**
   * Recording the track keeps the GPS receiver running, so the preference is remembered:
   * a reload part-way through a trip resumes the recording instead of losing the rest of it.
   */
  showTrack: boolean;
};

const DEFAULTS: MapSettings = { showPanZoomButtons: false, showTrack: false };

export function readMapSettings(): MapSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof value !== "object" || value === null) return { ...DEFAULTS };
    const stored = value as Partial<Record<keyof MapSettings, unknown>>;
    return {
      showPanZoomButtons: typeof stored.showPanZoomButtons === "boolean"
        ? stored.showPanZoomButtons
        : DEFAULTS.showPanZoomButtons,
      showTrack: typeof stored.showTrack === "boolean" ? stored.showTrack : DEFAULTS.showTrack,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** A browser that refuses storage still honours the setting for this session. */
export function writeMapSettings(settings: MapSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode and quota failures must not break the toggle.
  }
}
