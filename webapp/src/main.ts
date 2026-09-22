import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { parseChartPackageManifest } from "./chart-package";
import { configuredManifestUrl } from "./chart-package-url";
import { MapControls } from "./controls/map-controls";
import { NorthIndicator } from "./controls/north-indicator";
import { PositionTracker, type PositionState } from "./gps/position-tracker";
import { centerMapOn } from "./map/center-on-position";
import { createMap } from "./map/create-map";
import { addDemoChartLayers, addPackageChartLayers } from "./map/chart-layers";
import { displayScaleDenominator, evaluateChartScale } from "./map/chart-scale";
import { initialChartBounds, selectChartCells } from "./map/cell-selection";
import { addPositionLayer, updatePositionLayer } from "./map/position-layer";
import { createPopupDispatcher } from "./map/popup-dispatcher";
import { RangeMark } from "./map/range-mark";
import { addTrackLayer, setTrackLayerVisible, updateTrackLayer } from "./map/track-layer";
import { TrackRecorder, type TrackRecorderState } from "./track/track-recorder";
import { trackDistanceMetres, trackPointCount } from "./track/track-store";
import { OfflineControls } from "./offline/offline-controls";
import { cleanupInactivePackages, readOfflineManifest } from "./offline/chart-store";
import {
  isPositionStale,
  millisecondsUntilPositionStale,
  renderLocationMessage,
  renderPositionStatus,
} from "./ui/location-status";
import { Drawer } from "./ui/drawer";
import { renderRangeBearing } from "./ui/range-bearing-status";
import { renderDisplaySettings } from "./ui/display-settings";
import { TrackSettingsView, type TrackSettingsState } from "./ui/track-settings";
import { readMapSettings, writeMapSettings } from "./ui/map-settings";
import {
  createScaleStatusView,
  renderChartError,
  renderChartLoading,
  renderChartStatus,
  renderPackageChartStatus,
} from "./ui/chart-status";

const mapElement = requiredElement("map");
const controlsElement = requiredElement("map-controls");
const northIndicatorElement = requiredElement("north-indicator");
const chartStatusElement = requiredElement("chart-status");
const locationStatusElement = requiredElement("location-status");
const scaleStatusElement = requiredElement("scale-status");
const rangeBearingElement = requiredElement("range-bearing-status");
const offlinePanelElement = requiredElement("offline-panel");
const displaySettingsElement = requiredElement("display-settings");
const trackSettingsElement = requiredElement("track-settings");
const drawer = new Drawer({
  panel: requiredElement("drawer"),
  toggle: requiredButton("drawer-toggle"),
  close: requiredButton("drawer-close"),
  scrim: requiredElement("drawer-scrim"),
  alert: requiredElement("drawer-alert"),
});
const offlineAppReady = "serviceWorker" in navigator && import.meta.env.PROD
  ? navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL })
    .then(async () => { await navigator.serviceWorker.ready; return true; })
    .catch(() => false)
  : undefined;

const map = createMap(mapElement);
const mapLoaded = new Promise<void>((resolve) => map.once("load", () => resolve()));
// One click handler answers for the whole map, so a tap that lands on several
// things at once opens a single popup for the most specific of them. Chart
// layers and the user's mark both register here.
const popupDispatcher = createPopupDispatcher(map);
let controls: MapControls;
let latestPosition: GeolocationPosition | undefined;
let rangeMark: RangeMark | undefined;
/** Why the fix cannot be trusted, carried into the range readout. */
let positionProblem: string | undefined;
let stalePositionTimer: number | undefined;
let trackNotice: string | undefined;
let trackLayerReady = false;
// The toggle carries one badge, so each source of trouble is tracked separately and a
// resolved track failure cannot clear a chart failure that is still unresolved.
let chartAlert: string | undefined;
let trackAlert: string | undefined;

const tracker = new PositionTracker(navigator.geolocation, (state) => handlePositionState(state));
const trackRecorder = new TrackRecorder({ onChange: (state) => handleTrackChange(state) });

let mapSettings = readMapSettings();

controls = new MapControls(controlsElement, {
  map,
  onFollowChange(following) {
    if (following && latestPosition) centerMapOn(map, latestPosition);
    syncPositionWatch();
  },
});

controls.setPanZoomButtonsVisible(mapSettings.showPanZoomButtons);
renderDisplaySettings(displaySettingsElement, {
  showPanZoomButtons: mapSettings.showPanZoomButtons,
  onShowPanZoomButtonsChange(visible) {
    controls.setPanZoomButtonsVisible(visible);
    mapSettings = { ...mapSettings, showPanZoomButtons: visible };
    writeMapSettings(mapSettings);
  },
});

const trackSettings = new TrackSettingsView(trackSettingsElement, {
  onRecordingChange(recording) {
    trackNotice = undefined;
    trackAlert = undefined;
    refreshDrawerAlert();
    mapSettings = { ...mapSettings, showTrack: recording };
    writeMapSettings(mapSettings);
    if (recording) trackRecorder.start(); else trackRecorder.stop();
    // Recording is the only reason the receiver stays on once the map stops following.
    syncPositionWatch();
  },
  onClear() {
    trackRecorder.clear();
  },
});
trackSettings.render(trackSettingsState(trackRecorder.state));
if (mapSettings.showTrack) {
  // A reload part-way through a trip resumes recording rather than leaving a hole in the track.
  trackRecorder.start();
  syncPositionWatch();
}

new NorthIndicator(northIndicatorElement, map);

map.on("dragstart", () => {
  if (!controls.isFollowing) return;
  controls.setFollowing(false);
  // Panning away only ends the follow; a recording in progress keeps the receiver on.
  syncPositionWatch(false);
  renderLatestPosition();
});

renderLocationMessage(locationStatusElement, "");
void initializeChart();

async function initializeChart(): Promise<void> {
  const requestedManifestUrl = configuredManifestUrl(
    window.location.search,
    window.location.href,
    import.meta.env.VITE_CHART_MANIFEST_URL
      ?? (import.meta.env.DEV ? "/data/packages/western-lake-superior/manifest.json" : undefined),
  );

  try {
    if (!requestedManifestUrl) {
      renderChartStatus(chartStatusElement);
      await mapLoaded;
      addDemoChartLayers(map, popupDispatcher);
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
    const chartLayers = addPackageChartLayers(map, manifest, manifestUrl, popupDispatcher);
    const supportsCoverageMosaic = manifest.tileSets
      .filter((tileSet) => tileSet.format === "pmtiles")
      .every((tileSet) => tileSet.layers.includes("coverage"));
    const [west, south, east, north] = initialChartBounds(manifest.cells, manifest.bounds);
    renderPackageChartStatus(chartStatusElement, manifest, manifestUrl);
    const showScaleStatus = createScaleStatusView(scaleStatusElement);
    let selectedCells = [] as typeof manifest.cells;
    const updateScaleStatus = (): void => {
      const center = map.getCenter();
      const exactlyCoveredCellNames = chartLayers.coverageCellNamesAtCenter();
      const statusCells = exactlyCoveredCellNames === undefined
        ? selectedCells
        : selectedCells.filter((cell) => exactlyCoveredCellNames.includes(cell.name));
      showScaleStatus(evaluateChartScale(statusCells, map.getZoom(), center.lng, center.lat));
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
    // The drawer hides the chart panel by default, so a package that failed to load has to
    // announce itself instead of waiting for the user to open the menu.
    chartAlert = "Chart package unavailable";
    refreshDrawerAlert();
    drawer.open();
  } finally {
    await mapLoaded;
    // Added before the position layer so the fix and its accuracy circle draw over the track.
    addTrackLayer(map);
    trackLayerReady = true;
    updateTrackLayer(map, trackRecorder.state.track);
    setTrackLayerVisible(map, trackRecorder.isRecording);
    addPositionLayer(map);
    if (latestPosition) updatePositionLayer(map, latestPosition, isPositionStale(latestPosition));
    // Added last so the user's own mark draws over the chart and the fix.
    rangeMark = new RangeMark({ map, dispatcher: popupDispatcher, onChange: () => renderRangeBearingStatus() });
    rangeMark.measureFrom(latestPosition, latestPosition ? isPositionStale(latestPosition) : false);
  }
}

function handlePositionState(state: PositionState): void {
  switch (state.kind) {
    case "idle":
      if (latestPosition) {
        renderLatestPosition();
      } else {
        renderLocationMessage(locationStatusElement, "Location follow stopped.");
      }
      break;
    case "requesting":
      clearStalePositionTimer();
      renderLocationMessage(locationStatusElement, "Requesting location…");
      break;
    case "tracking": {
      latestPosition = state.position;
      positionProblem = undefined;
      trackRecorder.positionUpdated(state.position);
      if (controls.isFollowing) centerMapOn(map, state.position);
      renderLatestPosition();
      break;
    }
    case "unsupported":
      controls.setFollowing(false);
      stopRecordingAfterPositionFailure("this browser does not support location services");
      renderPositionFailure("This browser does not support location services.");
      break;
    case "denied":
      tracker.stop(false);
      controls.setFollowing(false);
      stopRecordingAfterPositionFailure("location permission was denied");
      renderPositionFailure("Location permission was denied. Enable it in browser settings to show your position.");
      break;
    case "unavailable":
      tracker.stop(false);
      controls.setFollowing(false);
      stopRecordingAfterPositionFailure("no GPS position is available");
      renderPositionFailure("A GPS position is currently unavailable.");
      break;
    case "timeout":
      tracker.stop(false);
      controls.setFollowing(false);
      stopRecordingAfterPositionFailure("the location request timed out");
      renderPositionFailure("The location request timed out. Try again with a clearer view of the sky.");
      break;
    case "error":
      tracker.stop(false);
      controls.setFollowing(false);
      stopRecordingAfterPositionFailure(state.message);
      renderPositionFailure(`Location failed: ${state.message}`);
      break;
  }
}

/** The watch runs while the map is following, while the track is recording, or both. */
function syncPositionWatch(announce = true): void {
  const needed = controls.isFollowing || trackRecorder.isRecording;
  if (needed && !tracker.isTracking) {
    tracker.start();
    return;
  }
  if (!needed && tracker.isTracking) {
    tracker.stop(announce);
    return;
  }
  // The watch is already in the right state, but the follow label has changed.
  if (announce) renderLatestPosition();
}

function handleTrackChange(state: TrackRecorderState): void {
  if (trackLayerReady) {
    updateTrackLayer(map, state.track);
    setTrackLayerVisible(map, state.recording);
  }
  trackSettings.render(trackSettingsState(state));
}

function trackSettingsState(state: TrackRecorderState): TrackSettingsState {
  return {
    recording: state.recording,
    pointCount: trackPointCount(state.track),
    distanceMetres: trackDistanceMetres(state.track),
    trimmed: state.track.trimmed,
    storageFailed: state.storageFailed,
    notice: trackNotice,
  };
}

/**
 * Recording cannot continue without fixes, and the failures above all clear the watch.
 * Stopping loudly is better than a track that quietly records nothing for hours.
 */
function stopRecordingAfterPositionFailure(reason: string): void {
  trackRecorder.positionLost();
  if (!trackRecorder.isRecording) return;
  trackNotice = `Track recording stopped because ${reason}. The recorded track is still saved.`;
  mapSettings = { ...mapSettings, showTrack: false };
  writeMapSettings(mapSettings);
  trackRecorder.stop();
  trackAlert = "Track recording stopped";
  refreshDrawerAlert();
}

function refreshDrawerAlert(): void {
  drawer.setAlert(chartAlert ?? trackAlert);
}

function renderPositionFailure(message: string): void {
  clearStalePositionTimer();
  positionProblem = message;
  if (!latestPosition) {
    renderLocationMessage(locationStatusElement, message, true);
    renderRangeBearingStatus();
    return;
  }

  updatePositionLayer(map, latestPosition, true);
  rangeMark?.measureFrom(latestPosition, true);
  renderPositionStatus(locationStatusElement, latestPosition, "paused", Date.now(), {
    forceStale: true,
    notice: message,
  });
  renderRangeBearingStatus(true);
}

function renderLatestPosition(): void {
  if (!latestPosition) return;
  const now = Date.now();
  const stale = isPositionStale(latestPosition, now);
  updatePositionLayer(map, latestPosition, stale);
  // Every re-read of the GPS lands here, which is what keeps the range and
  // bearing to the mark current.
  rangeMark?.measureFrom(latestPosition, stale);
  renderRangeBearingStatus(undefined, now);
  renderPositionStatus(
    locationStatusElement,
    latestPosition,
    controls.isFollowing ? "following" : "paused",
    now,
  );
  clearStalePositionTimer();
  if (stale) return;

  const position = latestPosition;
  stalePositionTimer = window.setTimeout(() => {
    if (latestPosition !== position) return;
    renderLatestPosition();
  }, millisecondsUntilPositionStale(position, now) + 1);
}

/**
 * The range readout is redrawn from the same fix the location banner uses, so
 * the two can never disagree about how old the position is.
 */
function renderRangeBearingStatus(forceStale?: boolean, now = Date.now()): void {
  renderRangeBearing(rangeBearingElement, {
    mark: rangeMark?.mark,
    position: latestPosition,
    now,
    forceStale,
    notice: positionProblem,
  });
}

function clearStalePositionTimer(): void {
  if (stalePositionTimer === undefined) return;
  window.clearTimeout(stalePositionTimer);
  stalePositionTimer = undefined;
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
