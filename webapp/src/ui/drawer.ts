type DrawerElements = {
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  close: HTMLButtonElement;
  scrim: HTMLElement;
  /** Shown on the toggle when `setAlert` reports a problem hidden inside the drawer. */
  alert: HTMLElement;
};

/**
 * A single sliding panel that holds the chart provenance and offline storage sections, so
 * neither one covers the map on a phone. Closed, the panel is `inert` rather than `hidden`
 * so it can animate; the toggle carries an alert badge because a failure state rendered
 * inside a closed drawer would otherwise be invisible.
 */
export class Drawer {
  readonly #elements: DrawerElements;
  readonly #toggleLabel: string;
  #open = false;

  constructor(elements: DrawerElements) {
    this.#elements = elements;
    this.#toggleLabel = elements.toggle.getAttribute("aria-label") ?? "Menu";

    elements.toggle.addEventListener("click", () => this.toggle());
    elements.close.addEventListener("click", () => this.close());
    elements.scrim.addEventListener("click", () => this.close());
    elements.panel.ownerDocument.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.#open) return;
      event.preventDefault();
      this.close();
    });

    this.#apply();
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    if (this.#open) return;
    this.#open = true;
    this.#apply();
    this.#elements.close.focus();
  }

  close(): void {
    if (!this.#open) return;
    const restoreFocus = this.#elements.panel.contains(this.#elements.panel.ownerDocument.activeElement);
    this.#open = false;
    this.#apply();
    if (restoreFocus) this.#elements.toggle.focus();
  }

  toggle(): void {
    if (this.#open) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Flags the toggle when the drawer holds a failure the user needs to see. */
  setAlert(message?: string): void {
    const { alert, toggle } = this.#elements;
    alert.hidden = message === undefined;
    if (message === undefined) {
      alert.removeAttribute("title");
    } else {
      alert.title = message;
    }
    toggle.classList.toggle("is-alert", message !== undefined);
    toggle.setAttribute("aria-label", message === undefined ? this.#toggleLabel : `${this.#toggleLabel} — ${message}`);
  }

  #apply(): void {
    const { panel, scrim, toggle } = this.#elements;
    panel.classList.toggle("is-open", this.#open);
    panel.toggleAttribute("inert", !this.#open);
    scrim.hidden = !this.#open;
    toggle.setAttribute("aria-expanded", String(this.#open));
  }
}
