import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMapSettings, writeMapSettings } from "./map-settings";

describe("map settings", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("hides the pan and zoom buttons until the user opts in", () => {
    expect(readMapSettings().showPanZoomButtons).toBe(false);
  });

  it("round-trips a stored preference", () => {
    writeMapSettings({ showPanZoomButtons: true });
    expect(readMapSettings().showPanZoomButtons).toBe(true);
  });

  it("falls back to the default for unreadable or malformed storage", () => {
    localStorage.setItem("chartplotter.map-settings.v1", "not json");
    expect(readMapSettings().showPanZoomButtons).toBe(false);

    localStorage.setItem("chartplotter.map-settings.v1", JSON.stringify({ showPanZoomButtons: "yes" }));
    expect(readMapSettings().showPanZoomButtons).toBe(false);
  });

  it("keeps working when the browser refuses to store the preference", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => writeMapSettings({ showPanZoomButtons: true })).not.toThrow();
  });
});
