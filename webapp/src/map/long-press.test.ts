import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  LONG_PRESS_HOLD_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  type LongPressPoint,
  suppressNextContextMenu,
  watchLongPress,
} from "./long-press";

type PressInit = {
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
  clientX?: number;
  clientY?: number;
};

function press(type: string, init: PressInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "touch",
    isPrimary: init.isPrimary ?? true,
    clientX: init.clientX ?? 100,
    clientY: init.clientY ?? 100,
  });
}

describe("long press", () => {
  let target: HTMLElement;
  let onLongPress: Mock<(point: LongPressPoint) => void>;
  let stopWatching: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    target = document.createElement("div");
    document.body.append(target);
    onLongPress = vi.fn();
    stopWatching = watchLongPress(target, { onLongPress });
  });

  afterEach(() => {
    stopWatching();
    target.remove();
    vi.useRealTimers();
  });

  it("fires once the finger has been held still for the hold time", () => {
    target.dispatchEvent(press("pointerdown", { clientX: 140, clientY: 90 }));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS - 1);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // jsdom reports a zero-origin bounding box, so element coordinates are the
    // client coordinates; what matters is that the press position is carried.
    expect(onLongPress).toHaveBeenCalledWith({ x: 140, y: 90 });
  });

  it("cancels when the finger moves far enough to be a pan", () => {
    target.dispatchEvent(press("pointerdown", { clientX: 100, clientY: 100 }));
    target.dispatchEvent(press("pointermove", {
      clientX: 100 + LONG_PRESS_MOVE_TOLERANCE_PX + 1,
      clientY: 100,
    }));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS * 4);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("tolerates the small drift of a finger that is trying to hold still", () => {
    target.dispatchEvent(press("pointerdown", { clientX: 100, clientY: 100 }));
    target.dispatchEvent(press("pointermove", { clientX: 103, clientY: 104 }));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("ignores movement from a different pointer", () => {
    target.dispatchEvent(press("pointerdown", { pointerId: 1 }));
    target.dispatchEvent(press("pointermove", { pointerId: 9, clientX: 400, clientY: 400 }));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("abandons the press when the finger lifts, is cancelled, or leaves", () => {
    for (const ending of ["pointerup", "pointercancel", "pointerleave"]) {
      onLongPress.mockClear();
      target.dispatchEvent(press("pointerdown"));
      target.dispatchEvent(press(ending));

      vi.advanceTimersByTime(LONG_PRESS_HOLD_MS);
      expect(onLongPress, ending).not.toHaveBeenCalled();
    }
  });

  it("abandons the press when a second finger joins, so a pinch never drops a mark", () => {
    target.dispatchEvent(press("pointerdown", { pointerId: 1 }));
    target.dispatchEvent(press("pointerdown", { pointerId: 2, isPrimary: false }));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS * 4);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("leaves mouse input to the context menu", () => {
    target.dispatchEvent(press("pointerdown", { pointerType: "mouse" }));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS * 4);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("swallows the context menu the platform synthesises from the same press", () => {
    target.dispatchEvent(press("pointerdown"));
    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS);

    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);

    // Only the one: a deliberate right-click afterwards still gets through.
    const later = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("stops watching on demand", () => {
    stopWatching();
    target.dispatchEvent(press("pointerdown"));

    vi.advanceTimersByTime(LONG_PRESS_HOLD_MS * 4);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe("context menu suppression", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("expires rather than swallowing a menu the user asked for much later", () => {
    suppressNextContextMenu(1_000);
    vi.advanceTimersByTime(1_001);

    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });

  it("stops the event before a listener on the element itself sees it", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const listener = vi.fn();
    element.addEventListener("contextmenu", listener);

    suppressNextContextMenu();
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    expect(listener).not.toHaveBeenCalled();
    element.remove();
  });
});
