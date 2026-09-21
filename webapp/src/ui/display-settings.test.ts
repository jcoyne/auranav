import { describe, expect, it, vi } from "vitest";
import { renderDisplaySettings } from "./display-settings";

describe("renderDisplaySettings", () => {
  it("reflects the current preference and reports changes", () => {
    const container = document.createElement("section");
    const onShowPanZoomButtonsChange = vi.fn();

    renderDisplaySettings(container, { showPanZoomButtons: false, onShowPanZoomButtonsChange });

    const checkbox = container.querySelector("input");
    if (!checkbox) throw new Error("Expected a checkbox");
    expect(checkbox.checked).toBe(false);
    expect(container.textContent).toContain("Pan and zoom buttons");

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(onShowPanZoomButtonsChange).toHaveBeenCalledWith(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(onShowPanZoomButtonsChange).toHaveBeenLastCalledWith(false);
  });

  it("starts checked when the buttons are already shown", () => {
    const container = document.createElement("section");

    renderDisplaySettings(container, { showPanZoomButtons: true, onShowPanZoomButtonsChange: vi.fn() });

    expect(container.querySelector("input")?.checked).toBe(true);
  });
});
