import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Popup } from "maplibre-gl";
import { formatFeatureDetailsList } from "./chart-features";
import { type ChartInteraction, chooseInteraction } from "./feature-popup";

/**
 * The one place a tap on the map becomes a popup.
 *
 * Every tappable thing — charted features and the user's own mark — registers
 * here rather than adding its own `click` handler, because a tap lands on
 * several layers at once: a sounding inside a restricted area used to open two
 * popups stacked over each other. `chooseInteraction` picks the single most
 * specific hit, and only that one speaks.
 *
 * The dispatcher is owned by the application rather than by the chart layers,
 * so features that are not part of a chart package can register too and the
 * behaviour is the same whether or not a chart package loaded.
 */
export type PopupDispatcher = {
  /** Makes a layer tappable. Later registrations do not displace earlier ones. */
  register(interaction: ChartInteraction): void;
  /** Closes the open popup, if the thing it describes has just gone away. */
  closePopup(): void;
};

export function createPopupDispatcher(map: MapLibreMap): PopupDispatcher {
  const interactions: ChartInteraction[] = [];
  let openPopup: Popup | undefined;

  map.on("click", (event: MapLayerMouseEvent) => {
    const chosen = chooseInteraction(map.queryRenderedFeatures(event.point), interactions);
    if (chosen === undefined) return;

    const content = chosen.interaction.render === undefined
      ? formatFeatureDetailsList(chosen.properties, chosen.interaction.format)
      : chosen.interaction.render(chosen.properties);
    // A feature that has nothing to say opens nothing at all.
    if (content === "") return;

    const popup = new Popup({ closeButton: true, focusAfterOpen: true }).setLngLat(event.lngLat);
    if (typeof content === "string") popup.setText(content); else popup.setDOMContent(content);

    openPopup?.remove();
    openPopup = popup;
    popup.on("close", () => {
      if (openPopup === popup) openPopup = undefined;
    });
    popup.addTo(map);
  });

  return {
    register(interaction) {
      interactions.push(interaction);
    },
    closePopup() {
      openPopup?.remove();
      openPopup = undefined;
    },
  };
}
