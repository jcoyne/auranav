export type MapActions = {
  panBy(offset: [number, number]): void;
  zoomIn(): void;
  zoomOut(): void;
};

type ControlOptions = {
  map: MapActions;
  onFollowChange(following: boolean): void;
};

const PAN_DISTANCE = 120;

export class MapControls {
  readonly #followButton: HTMLButtonElement;
  #following = false;

  constructor(container: HTMLElement, options: ControlOptions) {
    const panPad = document.createElement("div");
    panPad.className = "pan-pad";
    panPad.setAttribute("aria-label", "Pan map");

    const pan = (offset: [number, number]): void => {
      if (this.#following) {
        this.setFollowing(false);
        options.onFollowChange(false);
      }
      options.map.panBy(offset);
    };
    panPad.append(
      this.#button("↑", "Pan up", () => pan([0, -PAN_DISTANCE]), "pan-north"),
      this.#button("←", "Pan left", () => pan([-PAN_DISTANCE, 0]), "pan-west"),
      this.#button("→", "Pan right", () => pan([PAN_DISTANCE, 0]), "pan-east"),
      this.#button("↓", "Pan down", () => pan([0, PAN_DISTANCE]), "pan-south"),
    );

    const zoomGroup = document.createElement("div");
    zoomGroup.className = "control-group";
    zoomGroup.setAttribute("aria-label", "Zoom map");
    zoomGroup.append(
      this.#button("+", "Zoom in", () => options.map.zoomIn()),
      this.#button("−", "Zoom out", () => options.map.zoomOut()),
    );

    this.#followButton = this.#button("⌾", "Center and follow your location", () => {
      this.setFollowing(!this.#following);
      options.onFollowChange(this.#following);
    });
    this.#followButton.setAttribute("aria-pressed", "false");
    this.#followButton.classList.add("locate-button");

    container.append(panPad, zoomGroup, this.#followButton);
  }

  setFollowing(following: boolean): void {
    this.#following = following;
    this.#followButton.setAttribute("aria-pressed", String(following));
    this.#followButton.setAttribute(
      "aria-label",
      following ? "Stop following your location" : "Center and follow your location",
    );
    this.#followButton.classList.toggle("is-active", following);
  }

  get isFollowing(): boolean {
    return this.#following;
  }

  #button(label: string, accessibleName: string, action: () => void, className?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", accessibleName);
    button.title = accessibleName;
    if (className) button.classList.add(className);
    button.addEventListener("click", action);
    return button;
  }
}
