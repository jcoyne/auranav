export type TrackSettingsState = {
  recording: boolean;
  pointCount: number;
  distanceMetres: number;
  /** Set once the oldest points have been dropped to stay inside the storage budget. */
  trimmed: boolean;
  storageFailed: boolean;
  /** Why recording stopped on its own, such as a denied or failed GPS fix. */
  notice?: string;
};

export type TrackSettingsOptions = {
  onRecordingChange(recording: boolean): void;
  onClear(): void;
};

/** The drawer section for recording, showing, and clearing the GPS track. */
export class TrackSettingsView {
  readonly #container: HTMLElement;
  readonly #options: TrackSettingsOptions;
  #confirmingClear = false;
  #state: TrackSettingsState = {
    recording: false,
    pointCount: 0,
    distanceMetres: 0,
    trimmed: false,
    storageFailed: false,
  };

  constructor(container: HTMLElement, options: TrackSettingsOptions) {
    this.#container = container;
    this.#options = options;
  }

  render(state: TrackSettingsState = this.#state): void {
    this.#state = state;
    if (state.pointCount === 0) this.#confirmingClear = false;
    this.#container.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = "Track";

    const row = document.createElement("label");
    row.className = "settings-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.recording;
    checkbox.addEventListener("change", () => this.#options.onRecordingChange(checkbox.checked));
    const text = document.createElement("span");
    text.textContent = "Record and show track";
    row.append(checkbox, text);

    const status = document.createElement("p");
    status.className = "track-status";
    status.textContent = trackStatusText(state);

    this.#container.append(heading, row, status);

    if (state.trimmed) {
      this.#container.append(note("The track reached its storage limit, so the oldest points were dropped."));
    }
    if (state.storageFailed) {
      this.#container.append(note("This browser refused to save the track, so it will be lost on reload.", "track-error"));
    }
    if (state.notice) {
      this.#container.append(note(state.notice, "track-error"));
    }
    this.#container.append(note(
      state.recording
        ? "Sampling your GPS position every 15 seconds. This keeps the receiver on even when the map is not following you."
        : "Turning this on samples your GPS position every 15 seconds and draws the yellow track line. Turning it off stops sampling and hides the line.",
    ));

    this.#container.append(this.#clearActions(state));
  }

  #clearActions(state: TrackSettingsState): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "offline-actions";

    if (!this.#confirmingClear) {
      const clear = button("Clear track");
      clear.className = "secondary";
      clear.disabled = state.pointCount === 0;
      clear.addEventListener("click", () => {
        this.#confirmingClear = true;
        this.render();
      });
      actions.append(clear);
      return actions;
    }

    const prompt = document.createElement("p");
    prompt.className = "track-confirm";
    prompt.textContent = "Delete the recorded track? This cannot be undone.";
    const confirm = button("Clear track");
    confirm.addEventListener("click", () => {
      this.#confirmingClear = false;
      this.#options.onClear();
    });
    const cancel = button("Cancel");
    cancel.className = "secondary";
    cancel.addEventListener("click", () => {
      this.#confirmingClear = false;
      this.render();
    });
    actions.append(confirm, cancel);

    const wrapper = document.createElement("div");
    wrapper.append(prompt, actions);
    return wrapper;
  }
}

function trackStatusText(state: TrackSettingsState): string {
  if (state.pointCount === 0) {
    return state.recording ? "Waiting for a GPS fix…" : "No track recorded.";
  }
  const points = `${state.pointCount} ${state.pointCount === 1 ? "point" : "points"}`;
  return `${points} · ${formatDistance(state.distanceMetres)}`;
}

/** Nautical miles are the chart's own unit; short tracks read better in metres. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres <= 0) return "0 m";
  const nauticalMiles = metres / 1852;
  if (nauticalMiles < 0.1) return `${Math.round(metres)} m`;
  return `${nauticalMiles.toFixed(nauticalMiles < 10 ? 2 : 1)} NM`;
}

function note(text: string, className = "track-note"): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  return element;
}
