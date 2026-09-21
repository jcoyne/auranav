import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackSettingsView, formatDistance, type TrackSettingsState } from "./track-settings";

const idle: TrackSettingsState = {
  recording: false,
  pointCount: 0,
  distanceMetres: 0,
  trimmed: false,
  storageFailed: false,
};

describe("track settings", () => {
  let container: HTMLElement;
  let onRecordingChange: ReturnType<typeof vi.fn<(recording: boolean) => void>>;
  let onClear: ReturnType<typeof vi.fn<() => void>>;

  function render(state: Partial<TrackSettingsState> = {}): TrackSettingsView {
    const settings = new TrackSettingsView(container, {
      onRecordingChange: (recording) => onRecordingChange(recording),
      onClear: () => onClear(),
    });
    settings.render({ ...idle, ...state });
    return settings;
  }

  function checkbox(): HTMLInputElement {
    const element = container.querySelector("input[type=checkbox]");
    if (!(element instanceof HTMLInputElement)) throw new Error("Expected a toggle");
    return element;
  }

  function buttonLabelled(label: string): HTMLButtonElement {
    const element = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    if (!element) throw new Error(`Expected a ${label} button`);
    return element;
  }

  beforeEach(() => {
    container = document.createElement("section");
    onRecordingChange = vi.fn<(recording: boolean) => void>();
    onClear = vi.fn<() => void>();
  });

  it("reports an empty track and disables clearing", () => {
    render();
    expect(checkbox().checked).toBe(false);
    expect(container.textContent).toContain("No track recorded.");
    expect(buttonLabelled("Clear track").disabled).toBe(true);
  });

  it("toggles recording on and off", () => {
    render();
    checkbox().checked = true;
    checkbox().dispatchEvent(new Event("change"));
    expect(onRecordingChange).toHaveBeenCalledWith(true);

    render({ recording: true, pointCount: 4, distanceMetres: 500 });
    checkbox().checked = false;
    checkbox().dispatchEvent(new Event("change"));
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it("shows the recorded length once there are points", () => {
    render({ recording: true, pointCount: 412, distanceMetres: 5_934 });
    expect(container.textContent).toContain("412 points · 3.20 NM");
  });

  it("says it is waiting while recording without a fix", () => {
    render({ recording: true });
    expect(container.textContent).toContain("Waiting for a GPS fix");
  });

  it("warns that recording keeps the receiver on", () => {
    render({ recording: true, pointCount: 1 });
    expect(container.textContent).toContain("even when the map is not following you");
  });

  it("asks for confirmation before clearing and only then clears", () => {
    render({ pointCount: 12, distanceMetres: 800 });
    buttonLabelled("Clear track").click();

    expect(onClear).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Delete the recorded track?");

    buttonLabelled("Clear track").click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("abandons the confirmation on cancel", () => {
    render({ pointCount: 12, distanceMetres: 800 });
    buttonLabelled("Clear track").click();
    buttonLabelled("Cancel").click();

    expect(onClear).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Delete the recorded track?");
    expect(buttonLabelled("Clear track").disabled).toBe(false);
  });

  it("drops a pending confirmation when the track is already empty", () => {
    const settings = render({ pointCount: 12, distanceMetres: 800 });
    buttonLabelled("Clear track").click();
    settings.render({ ...idle });

    expect(container.textContent).not.toContain("Delete the recorded track?");
  });

  it("reports trimming, refused storage, and why recording stopped", () => {
    render({
      pointCount: 20_000,
      distanceMetres: 90_000,
      trimmed: true,
      storageFailed: true,
      notice: "Track recording stopped because location permission was denied.",
    });

    expect(container.textContent).toContain("oldest points were dropped");
    expect(container.textContent).toContain("refused to save the track");
    expect(container.textContent).toContain("location permission was denied");
    expect(container.querySelectorAll(".track-error")).toHaveLength(2);
  });
});

describe("track distance formatting", () => {
  it("uses metres below a tenth of a nautical mile and nautical miles above it", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(120)).toBe("120 m");
    expect(formatDistance(1_852)).toBe("1.00 NM");
    expect(formatDistance(37_040)).toBe("20.0 NM");
    expect(formatDistance(Number.NaN)).toBe("0 m");
  });
});
