import { afterEach, describe, expect, it } from "vitest";
import { Drawer } from "./drawer";

function mountDrawer(): {
  drawer: Drawer;
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  close: HTMLButtonElement;
  scrim: HTMLElement;
  alert: HTMLElement;
} {
  document.body.innerHTML = `
    <button id="toggle" type="button" aria-label="Chart and offline menu" aria-expanded="false">
      Charts<span id="alert" hidden>!</span>
    </button>
    <div id="scrim" hidden></div>
    <aside id="panel" inert>
      <button id="close" type="button">Close</button>
      <a id="inside" href="https://example.test/agreement.txt">Agreement</a>
    </aside>
  `;
  const panel = document.getElementById("panel") as HTMLElement;
  const toggle = document.getElementById("toggle") as HTMLButtonElement;
  const close = document.getElementById("close") as HTMLButtonElement;
  const scrim = document.getElementById("scrim") as HTMLElement;
  const alert = document.getElementById("alert") as HTMLElement;
  return { drawer: new Drawer({ panel, toggle, close, scrim, alert }), panel, toggle, close, scrim, alert };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Drawer", () => {
  it("starts closed with its contents inert and its scrim hidden", () => {
    const { drawer, panel, toggle, scrim } = mountDrawer();

    expect(drawer.isOpen).toBe(false);
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(scrim.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens from the toggle and moves focus into the panel", () => {
    const { drawer, panel, toggle, close, scrim } = mountDrawer();

    toggle.click();

    expect(drawer.isOpen).toBe(true);
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(scrim.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(close);
  });

  it("closes from the toggle, the close button, the scrim, and Escape", () => {
    const { drawer, toggle, close, scrim } = mountDrawer();

    toggle.click();
    toggle.click();
    expect(drawer.isOpen).toBe(false);

    drawer.open();
    close.click();
    expect(drawer.isOpen).toBe(false);

    drawer.open();
    scrim.click();
    expect(drawer.isOpen).toBe(false);

    drawer.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(drawer.isOpen).toBe(false);
  });

  it("returns focus to the toggle only when focus was inside the panel", () => {
    const { drawer, toggle } = mountDrawer();
    const outside = document.getElementById("scrim") as HTMLElement;
    outside.tabIndex = 0;

    drawer.open();
    drawer.close();
    expect(document.activeElement).toBe(toggle);

    drawer.open();
    outside.focus();
    drawer.close();
    expect(document.activeElement).toBe(outside);
  });

  it("ignores Escape while closed so it does not steal the key from the map", () => {
    mountDrawer();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("surfaces a hidden failure on the toggle until it is cleared", () => {
    const { drawer, toggle, alert } = mountDrawer();

    drawer.setAlert("Chart package unavailable");
    expect(alert.hidden).toBe(false);
    expect(toggle.classList.contains("is-alert")).toBe(true);
    expect(toggle.getAttribute("aria-label")).toBe("Chart and offline menu — Chart package unavailable");

    drawer.setAlert();
    expect(alert.hidden).toBe(true);
    expect(toggle.classList.contains("is-alert")).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Chart and offline menu");
  });
});
