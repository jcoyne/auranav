/**
 * Long-press detection for touch and pen input.
 *
 * A press only counts if the finger stays put: panning the chart begins with
 * exactly the same `pointerdown`, so any movement past a small tolerance, a
 * second finger, or a pointer that leaves the element abandons the gesture.
 * Mouse input is deliberately not handled here — a desktop caller should use
 * the `contextmenu` event, which is the platform's own "act on this spot".
 *
 * After firing, the browser's own long-press menu is suppressed once, so a
 * platform that synthesises `contextmenu` from the same press cannot act on
 * the gesture a second time.
 */

export const LONG_PRESS_HOLD_MS = 500;
/**
 * CSS pixels of slop allowed while holding. A finger on glass drifts a few
 * pixels even when the user means to hold still; a pan moves much further.
 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
/** How long a synthesised context menu is swallowed after the press fires. */
const CONTEXT_MENU_SUPPRESSION_MS = 1_000;

/** Position of the press, in pixels relative to the watched element. */
export type LongPressPoint = {
  readonly x: number;
  readonly y: number;
};

export type LongPressOptions = {
  readonly onLongPress: (point: LongPressPoint) => void;
  readonly holdMs?: number;
  readonly moveTolerancePx?: number;
};

type PendingPress = {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly timer: number;
};

/**
 * Watches `target` for a long press. Returns a function that stops watching
 * and drops any press in progress.
 */
export function watchLongPress(target: HTMLElement, options: LongPressOptions): () => void {
  const holdMs = options.holdMs ?? LONG_PRESS_HOLD_MS;
  const moveTolerancePx = options.moveTolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX;
  let pending: PendingPress | undefined;

  const cancel = (): void => {
    if (pending === undefined) return;
    window.clearTimeout(pending.timer);
    pending = undefined;
  };

  const onPointerDown = (event: PointerEvent): void => {
    // A second finger means a pinch or a two-finger pan, never a long press.
    if (pending !== undefined) {
      cancel();
      return;
    }
    if (event.pointerType === "mouse" || event.isPrimary === false) return;

    const { pointerId, clientX, clientY } = event;
    const timer = window.setTimeout(() => {
      pending = undefined;
      suppressNextContextMenu();
      options.onLongPress(elementPoint(target, clientX, clientY));
    }, holdMs);
    pending = { pointerId, clientX, clientY, timer };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pending === undefined || event.pointerId !== pending.pointerId) return;
    const movedPx = Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY);
    if (movedPx > moveTolerancePx) cancel();
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (pending === undefined || event.pointerId !== pending.pointerId) return;
    cancel();
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerEnd);
  target.addEventListener("pointercancel", onPointerEnd);
  target.addEventListener("pointerleave", onPointerEnd);

  return () => {
    cancel();
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerEnd);
    target.removeEventListener("pointercancel", onPointerEnd);
    target.removeEventListener("pointerleave", onPointerEnd);
  };
}

/**
 * Swallows one `contextmenu` event, document-wide and in the capture phase so
 * it is stopped before any listener the map renderer put on its own canvas.
 * Without this, a platform that turns a long press into a context menu would
 * place the mark twice.
 */
export function suppressNextContextMenu(durationMs = CONTEXT_MENU_SUPPRESSION_MS): () => void {
  let expiry: number | undefined;

  const stop = (): void => {
    if (expiry !== undefined) window.clearTimeout(expiry);
    document.removeEventListener("contextmenu", swallow, true);
  };

  function swallow(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    stop();
  }

  document.addEventListener("contextmenu", swallow, true);
  expiry = window.setTimeout(stop, durationMs);
  return stop;
}

function elementPoint(target: HTMLElement, clientX: number, clientY: number): LongPressPoint {
  const bounds = target.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}
