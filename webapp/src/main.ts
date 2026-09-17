import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { MapControls } from "./controls/map-controls";
import { PositionTracker, type PositionState } from "./gps/position-tracker";
import { centerMapOn } from "./map/center-on-position";
import { createMap } from "./map/create-map";
import { addPositionLayer, updatePositionLayer } from "./map/position-layer";
import { renderChartStatus, renderLocationStatus } from "./ui/chart-status";

const mapElement = requiredElement("map");
const controlsElement = requiredElement("map-controls");
const chartStatusElement = requiredElement("chart-status");
const locationStatusElement = requiredElement("location-status");

const map = createMap(mapElement);
let controls: MapControls;
let latestPosition: GeolocationPosition | undefined;

const tracker = new PositionTracker(navigator.geolocation, (state) => handlePositionState(state));

controls = new MapControls(controlsElement, {
  map,
  onFollowChange(following) {
    if (following) {
      if (latestPosition) centerMapOn(map, latestPosition);
      tracker.start();
    } else {
      tracker.stop();
    }
  },
});

map.on("load", () => {
  addPositionLayer(map);
  if (latestPosition) updatePositionLayer(map, latestPosition);
});
map.on("dragstart", () => {
  if (!controls.isFollowing) return;
  controls.setFollowing(false);
  tracker.stop(false);
  renderLocationStatus(locationStatusElement, "Location follow paused after manual pan.");
});

renderChartStatus(chartStatusElement);
renderLocationStatus(locationStatusElement, "");

function handlePositionState(state: PositionState): void {
  switch (state.kind) {
    case "idle":
      renderLocationStatus(locationStatusElement, "Location follow stopped.");
      break;
    case "requesting":
      renderLocationStatus(locationStatusElement, "Requesting location…");
      break;
    case "tracking": {
      latestPosition = state.position;
      updatePositionLayer(map, state.position);
      if (controls.isFollowing) centerMapOn(map, state.position);
      const { accuracy } = state.position.coords;
      renderLocationStatus(
        locationStatusElement,
        `GPS accuracy ±${Math.round(accuracy)} m · ${new Date(state.position.timestamp).toLocaleTimeString()}`,
      );
      break;
    }
    case "unsupported":
      controls.setFollowing(false);
      renderLocationStatus(locationStatusElement, "This browser does not support location services.", true);
      break;
    case "denied":
      tracker.stop(false);
      controls.setFollowing(false);
      renderLocationStatus(locationStatusElement, "Location permission was denied. Enable it in browser settings to show your position.", true);
      break;
    case "unavailable":
      tracker.stop(false);
      controls.setFollowing(false);
      renderLocationStatus(locationStatusElement, "A GPS position is currently unavailable.", true);
      break;
    case "timeout":
      tracker.stop(false);
      controls.setFollowing(false);
      renderLocationStatus(locationStatusElement, "The location request timed out. Try again with a clearer view of the sky.", true);
      break;
    case "error":
      tracker.stop(false);
      controls.setFollowing(false);
      renderLocationStatus(locationStatusElement, `Location failed: ${state.message}`, true);
      break;
  }
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required element #${id} is missing`);
  return element;
}
