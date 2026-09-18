import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { parseChartPackageManifest } from "./chart-package";
import { configuredManifestUrl } from "./chart-package-url";
import { MapControls } from "./controls/map-controls";
import { PositionTracker, type PositionState } from "./gps/position-tracker";
import { centerMapOn } from "./map/center-on-position";
import { createMap } from "./map/create-map";
import { addDemoChartLayers, addPackageChartLayers } from "./map/chart-layers";
import { displayScaleDenominator, evaluateChartScale } from "./map/chart-scale";
import { selectChartCells } from "./map/cell-selection";
import { addPositionLayer, updatePositionLayer } from "./map/position-layer";
import { OfflineControls } from "./offline/offline-controls";
import { cleanupInactivePackages, readOfflineManifest } from "./offline/chart-store";
import {
  renderChartError,
  renderChartLoading,
  renderChartStatus,
  renderLocationStatus,
  renderPackageChartStatus,
  renderScaleStatus,
} from "./ui/chart-status";

const mapElement = requiredElement("map");
const controlsElement = requiredElement("map-controls");
const chartStatusElement = requiredElement("chart-status");
const locationStatusElement = requiredElement("location-status");
const scaleStatusElement = requiredElement("scale-status");
const offlineToggleElement = requiredButton("offline-toggle");
const offlinePanelElement = requiredElement("offline-panel");

offlineToggleElement.addEventListener("click", () => {
  const expanded = offlineToggleElement.getAttribute("aria-expanded") !== "true";
  offlineToggleElement.setAttribute("aria-expanded", String(expanded));
  offlinePanelElement.hidden = !expanded;
});
const offlineAppReady = "serviceWorker" in navigator && import.meta.env.PROD
  ? navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL })
    .then(async () => { await navigator.serviceWorker.ready; return true; })
    .catch(() => false)
  : undefined;

const map = createMap(mapElement);
const mapLoaded = new Promise<void>((resolve) => map.once("load", () => resolve()));
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

map.on("dragstart", () => {
  if (!controls.isFollowing) return;
  controls.setFollowing(false);
  tracker.stop(false);
  renderLocationStatus(locationStatusElement, "Location follow paused after manual pan.");
});

renderLocationStatus(locationStatusElement, "");
void initializeChart();

async function initializeChart(): Promise<void> {
  const requestedManifestUrl = configuredManifestUrl(
    window.location.search,
    window.location.href,
    import.meta.env.VITE_CHART_MANIFEST_URL
      ?? (import.meta.env.DEV ? "/data/packages/wisconsin/manifest.json" : undefined),
  );

  try {
    if (!requestedManifestUrl) {
      renderChartStatus(chartStatusElement);
      await mapLoaded;
      addDemoChartLayers(map);
      return;
    }

    renderChartLoading(chartStatusElement, requestedManifestUrl);
    let manifestValue: unknown;
    let manifestUrl = requestedManifestUrl;
    try {
      const response = await fetch(requestedManifestUrl, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Manifest request failed (${response.status} ${response.statusText})`);
      manifestValue = await response.json();
      manifestUrl = new URL(response.url || requestedManifestUrl.href);
    } catch (error) {
      manifestValue = await readOfflineManifest(requestedManifestUrl);
      if (manifestValue === undefined) throw error;
    }
    const manifest = parseChartPackageManifest(manifestValue);
    if (!manifest.tileSets.some((tileSet) => tileSet.format === "pmtiles")) {
      throw new Error("The chart package does not contain a PMTiles archive.");
    }
    await cleanupInactivePackages().catch(() => undefined);
    const offlineControls = new OfflineControls(offlinePanelElement, manifest, manifestUrl, offlineAppReady);
    await offlineControls.render();
    await mapLoaded;
    const chartLayers = addPackageChartLayers(map, manifest, manifestUrl);
    const supportsCoverageMosaic = manifest.tileSets
      .filter((tileSet) => tileSet.format === "pmtiles")
      .every((tileSet) => tileSet.layers.includes("coverage"));
    const [west, south, east, north] = manifest.bounds;
    renderPackageChartStatus(chartStatusElement, manifest, manifestUrl);
    let selectedCells = [] as typeof manifest.cells;
    const updateScaleStatus = (): void => {
      const center = map.getCenter();
      const exactlyCoveredCellNames = chartLayers.coverageCellNamesAtCenter();
      const statusCells = exactlyCoveredCellNames === undefined
        ? selectedCells
        : selectedCells.filter((cell) => exactlyCoveredCellNames.includes(cell.name));
      renderScaleStatus(
        scaleStatusElement,
        evaluateChartScale(statusCells, map.getZoom(), center.lng, center.lat),
      );
    };
    const updateChartView = (): void => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      selectedCells = selectChartCells(
        manifest.cells,
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        displayScaleDenominator(map.getZoom(), center.lat),
        supportsCoverageMosaic,
      );
      chartLayers.showCells(selectedCells.map((cell) => cell.name));
      updateScaleStatus();
    };
    map.on("moveend", updateChartView);
    map.on("idle", updateScaleStatus);
    map.fitBounds([[west, south], [east, north]], { padding: 48, duration: 0 });
    updateChartView();
  } catch (error) {
    await mapLoaded;
    renderChartError(chartStatusElement, error instanceof Error ? error.message : "Unknown chart package error");
  } finally {
    await mapLoaded;
    addPositionLayer(map);
    if (latestPosition) updatePositionLayer(map, latestPosition);
  }
}

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

function requiredButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Required button #${id} is missing`);
  return element;
}
