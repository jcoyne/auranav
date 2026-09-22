import { describe, expect, it, vi } from "vitest";
import { renderRangeMarkPopup } from "./range-mark-popup";

describe("range mark popup", () => {
  it("names the mark, shows where it is, and offers a real Remove button", () => {
    const onRemove = vi.fn();

    const panel = renderRangeMarkPopup({
      mark: { latitude: 46.81, longitude: -90.81 },
      onRemove,
    });

    expect(panel.textContent).toContain("Range and bearing mark");
    expect(panel.textContent).toContain("46.81000° N, 90.81000° W");

    const remove = panel.querySelector("button");
    // A real button is focusable and operable from the keyboard; a tappable
    // div is neither.
    expect(remove).toBeInstanceOf(HTMLButtonElement);
    expect(remove?.type).toBe("button");
    expect(remove?.textContent).toBe("Remove mark");

    remove?.click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
