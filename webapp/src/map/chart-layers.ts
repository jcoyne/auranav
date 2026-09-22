import type { ChartPackageManifest, DepthUnit, TileLayer } from "../chart-package";
import { resolvePackageAssetUrl } from "../chart-package-url";
import type { ExpressionSpecification, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { addProtocol, Popup } from "maplibre-gl";
import { PMTiles, Protocol } from "pmtiles";
import { createChartSource } from "../offline/chart-store";
import {
  demoCoastline,
  demoDepthAreas,
  demoDepthContours,
  demoSoundings,
} from "./demo-chart";
import { POSITION_ACCURACY_LAYER_ID, POSITION_FIX_LAYER_ID } from "./position-layer";
import { landLabelFilter } from "./land";
import {
  AREA_FEATURE,
  type ChartInteraction,
  chooseInteraction,
  LINE_FEATURE,
  POINT_FEATURE,
} from "./feature-popup";
import { depthConversionFactor, depthUnitLabel, formatDepthInUnit } from "./depth";
import { formatLightDetails } from "./light";
import { addLightFlareImages, lightFlareIconExpression } from "./light-icon";
import {
  addAnchoringPatternImage,
  addBuoyImages,
  addDangerImages,
  ANCHORING_PROHIBITED_PATTERN_ID,
  buoyIconExpression,
  dangerIconExpression,
} from "./chart-symbols";
import {
  formatAnchorageDetails,
  formatBuoyDetails,
  formatCableDetails,
  formatDangerDetails,
  formatFeatureDetailsList,
  formatHarbourFacilityDetails,
  formatMooringDetails,
  formatRestrictedAreaDetails,
  formatShorelineStructureDetails,
  type ChartFeatureProperties,
} from "./chart-features";
import { CONDITION_RUINED, s57CodeListIncludesExpression } from "./s57-codes";

export const DEMO_SOURCE_IDS = {
  coastline: "demo-coastline",
  depthArea: "demo-depth-area",
  depthContour: "demo-depth-contour",
  sounding: "demo-sounding",
} as const;

const protocol = new Protocol();
let protocolRegistered = false;

const LAND_LABEL_LAYER_PREFIX = "chart-land-label-";
const WATER_LABEL_LAYER_PREFIX = "chart-water-label-";

/**
 * Label layers that only the finest visible band may draw.
 *
 * Coarser cells stay rendered beneath the selected band and name the same island
 * or bay, so without this an anchor would be labelled twice. It applies to place
 * names alone. A harbour facility is not duplicated between bands the way a
 * landform is — Port Superior Village Marina is charted in the band 4 cell and
 * not in the band 5 cell over the same water — so suppressing the coarse band
 * there would hide the facility exactly when the navigator has zoomed in on it.
 */
const BAND_SUPPRESSED_LABEL_PREFIXES = [LAND_LABEL_LAYER_PREFIX, WATER_LABEL_LAYER_PREFIX];

const RESTRICTED_AREA_LAYER_PREFIX = "chart-restricted-area-";

/** Below roughly 1:100,000 the contours are too closely spaced to label legibly. */
const CONTOUR_LABEL_MIN_ZOOM = 11;

/** Aids and hazards are worth the clutter earlier than names are. */
const DANGER_MIN_ZOOM = 9;
const BUOY_MIN_ZOOM = 10;
const AREA_LABEL_MIN_ZOOM = 10;
const HARBOUR_MIN_ZOOM = 11;
const DANGER_LABEL_MIN_ZOOM = 12;
const BUOY_LABEL_MIN_ZOOM = 13;

/** A pier is small, but where it is at all is worth knowing before it is legible. */
const STRUCTURE_MIN_ZOOM = 11;
/** Armouring is coastline detail, so it waits for the zoom that details the coast. */
const ARMOURING_MIN_ZOOM = 13;
const MOORING_MIN_ZOOM = 12;
const RUIN_LABEL_MIN_ZOOM = 14;

const CHART_FONT = ["Noto Sans Regular"];
const LABEL_HALO = "#f5fbfc";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** Built structure: the tan of land, greyed so a pier reads as built, not natural. */
const STRUCTURE_FILL = "#ddcda4";
/** The coastline's own ink, so a pier reads as an extension of the shore. */
const STRUCTURE_INK = "#282716";
const ARMOURING_FILL = "#d5cfbe";
const ARMOURING_INK = "#9a9280";
const ARMOURING_OPACITY = 0.65;
/**
 * A ruin is grey and never the ink of a structure that can be used. Tying to a
 * ruined logging-era dock is the failure this distinction exists to prevent, so
 * it carries colour, a dashed edge and a label rather than any one of the three.
 */
const RUIN_FILL = "#c3bdb1";
const RUIN_INK = "#6f6a5c";
const RUIN_LABEL_COLOR = "#8a4a12";
const RUIN_DASHES: [number, number] = [2, 2];

/**
 * `SLCONS` is not homogeneous, and about 40% of it is shoreline armouring: rip
 * rap (`CATSLC` 8), revetment (9) and sea wall (10). That is coastline detail
 * rather than a structure to tie to, and drawn like a pier it buries the piers.
 */
const ARMOURING_CATEGORIES = ["8", "9", "10"];

const SHORELINE_STRUCTURE_PEER_PREFIX = "chart-shoreline-structure-";
const MOORING_PEER_PREFIX = "chart-mooring-";

/**
 * These layers carry point, line and area primitives together: the same pier is
 * an area in one cell and a line in another. Each primitive gets its own layer,
 * because a fill cannot draw a line and a line cannot draw a point.
 */
const POINT_ONLY: ExpressionSpecification = ["==", ["geometry-type"], "Point"];
const LINE_ONLY: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];
const POLYGON_ONLY: ExpressionSpecification = ["==", ["geometry-type"], "Polygon"];

export function addPackageChartLayers(
  map: MapLibreMap,
  manifest: ChartPackageManifest,
  manifestUrl: URL,
): {
  showCells(cellNames: readonly string[]): void;
  coverageCellNamesAtCenter(): string[] | undefined;
} {
  registerPmtilesProtocol();
  const added = new Map<number, string[]>();
  const usageBands = new Map(manifest.cells.map((cell) => [cell.name, cell.usageBand]));
  // One handler for every chart layer, so overlapping features yield a single
  // popup for whichever feature the tap was most specifically on.
  const interactions: ChartInteraction[] = [];
  addPopupDispatcher(map, interactions);
  let visibleCellNames = new Set<string>();

  return {
    showCells(cellNames) {
      const visibleCells = new Set(cellNames);
      visibleCellNames = visibleCells;
      const beforeId = positionLayerId(map);
      // Coarser cells stay rendered beneath the selected band and name the same
      // islands, so only the finest visible band may label a landform.
      const finestBand = Math.max(...cellNames.map((cellName) => usageBands.get(cellName) ?? 0));
      const applyVisibility = (layerIds: readonly string[], cellName: string): void => {
        const cellVisible = visibleCells.has(cellName);
        const labelsVisible = cellVisible && (usageBands.get(cellName) ?? 0) === finestBand;
        layerIds.forEach((layerId) => map.setLayoutProperty(
          layerId,
          "visibility",
          (isBandSuppressedLabel(layerId) ? labelsVisible : cellVisible) ? "visible" : "none",
        ));
      };
      manifest.tileSets.forEach((tileSet, index) => {
        if (tileSet.format !== "pmtiles") return;
        const existingLayerIds = added.get(index);
        if (existingLayerIds) {
          applyVisibility(existingLayerIds, tileSet.cellName);
          return;
        }
        if (!visibleCells.has(tileSet.cellName)) return;

        const archiveUrl = resolvePackageAssetUrl(tileSet.url, manifestUrl).href;
        protocol.add(new PMTiles(createChartSource(archiveUrl)));
        const sourceId = chartSourceId(index);
        map.addSource(sourceId, {
          type: "vector",
          url: `pmtiles://${archiveUrl}`,
          attribution: "NOAA Office of Coast Survey",
          minzoom: tileSet.minZoom,
          maxzoom: tileSet.maxZoom,
        });
        const layerIds = addVectorLayers(
          map,
          sourceId,
          index,
          tileSet.layers,
          manifest.depth.displayUnit,
          interactions,
          beforeId,
        );
        added.set(index, layerIds);
        applyVisibility(layerIds, tileSet.cellName);
      });

      // `cellNames` is coarse-to-detailed. Reapply that order because cells are
      // loaded lazily and may have first appeared in a different view.
      cellNames.forEach((cellName) => {
        manifest.tileSets.forEach((tileSet, index) => {
          if (tileSet.cellName !== cellName) return;
          added.get(index)?.forEach((layerId) => map.moveLayer(layerId, beforeId));
        });
      });

      // A restricted area belongs to whichever cell charted it, which is often a
      // coarser one than the harbour cell you are looking at. Left inside its
      // cell's group it is painted over by the finer cell's opaque coverage while
      // still answering clicks, so the same area looks different depending on
      // which cell overlays it. Hoist it clear of every cell, below GPS.
      added.forEach((layerIds) => layerIds
        .filter((layerId) => layerId.startsWith(RESTRICTED_AREA_LAYER_PREFIX))
        .forEach((layerId) => map.moveLayer(layerId, beforeId)));
    },
    coverageCellNamesAtCenter() {
      const layersToCells = new Map<string, string>();
      const cellsWithCoverage = new Set<string>();
      const visibleCoverageSources: string[] = [];
      manifest.tileSets.forEach((tileSet, index) => {
        if (!visibleCellNames.has(tileSet.cellName) || !tileSet.layers.includes("coverage")) return;
        const layerId = `chart-coverage-mask-${index}`;
        if (added.get(index)?.includes(layerId)) {
          layersToCells.set(layerId, tileSet.cellName);
          cellsWithCoverage.add(tileSet.cellName);
          visibleCoverageSources.push(chartSourceId(index));
        }
      });
      // Mixed old/new packages cannot provide complete exact coverage, so let
      // callers retain the bounds-based compatibility behavior.
      if ([...visibleCellNames].some((cellName) => !cellsWithCoverage.has(cellName))) return undefined;
      if (layersToCells.size === 0) return undefined;
      if (visibleCoverageSources.some((sourceId) => !map.isSourceLoaded(sourceId))) return undefined;

      const features = map.queryRenderedFeatures(map.project(map.getCenter()), {
        layers: [...layersToCells.keys()],
      });
      return [...new Set(features.flatMap((feature) => {
        const cellName = layersToCells.get(feature.layer.id);
        return cellName === undefined ? [] : [cellName];
      }))];
    },
  };
}

function chartSourceId(index: number): string {
  return `chart-${index}`;
}

function isBandSuppressedLabel(layerId: string): boolean {
  return BAND_SUPPRESSED_LABEL_PREFIXES.some((prefix) => layerId.startsWith(prefix));
}

function registerPmtilesProtocol(): void {
  if (protocolRegistered) return;
  addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

type LayerContext = {
  readonly map: MapLibreMap;
  readonly sourceId: string;
  readonly index: number;
  readonly displayUnit: DepthUnit;
  readonly beforeId: string | undefined;
  /** Collected as layers are added, then read by the one click handler. */
  readonly interactions: ChartInteraction[];
};

type ChartLayerSpecification = Parameters<MapLibreMap["addLayer"]>[0];

/**
 * Adds every layer one tile set contributes, in the order it is drawn.
 *
 * Layer order carries two meanings at once. A later layer draws on top, and
 * MapLibre places symbols in layer order, so an *earlier* symbol layer wins a
 * collision against a later one. The phases below are therefore ordered bottom
 * up for geometry and by collision priority for symbols:
 *
 * 1. geometry, from the sea bed up to the coastline and what is built on it;
 * 2. transparent touch targets, which draw nothing;
 * 3. symbols. Buoys and dangers come first because an aid or a hazard outranks
 *    every label; then sounding and light labels; then the names of aids, areas
 *    and facilities; and last the water and landform names.
 */
function addVectorLayers(
  map: MapLibreMap,
  sourceId: string,
  index: number,
  layers: TileLayer[],
  displayUnit: DepthUnit,
  interactions: ChartInteraction[],
  beforeId?: string,
): string[] {
  const context: LayerContext = { map, sourceId, index, displayUnit, beforeId, interactions };
  const layerIds: string[] = [];
  const phase = (
    sourceLayer: TileLayer,
    build: (context: LayerContext) => readonly string[],
  ): void => {
    if (layers.includes(sourceLayer)) layerIds.push(...build(context));
  };

  phase("coverage", addCoverageLayer);
  phase("depth-area", addDepthAreaLayer);
  phase("anchorage", addAnchorageAreaLayers);
  phase("restricted-area", addRestrictedAreaLayers);
  phase("restricted-area-edge", addRestrictedAreaEdgeLayer);
  phase("depth-contour", addDepthContourLineLayer);
  phase("cable", addCableLineLayer);
  phase("land-area", addLandAreaLayer);
  phase("coastline", addCoastlineLayer);
  // A pier is a physical structure laid over the water and the shore, so it
  // belongs with land and coastline and beneath every aid and hazard.
  phase("shoreline-structure", addShorelineStructureLayers);
  phase("mooring", addMooringLayers);
  phase("harbour-facility", addHarbourFacilityMarkerLayer);

  phase("sounding", addSoundingHitLayer);
  phase("light", addLightHitLayer);
  phase("buoy", addBuoyHitLayer);
  phase("danger", addDangerHitLayer);
  phase("harbour-facility", addHarbourFacilityHitLayer);
  phase("cable", addCableHitLayer);
  phase("shoreline-structure", addShorelineStructureHitLayers);
  phase("mooring", addMooringHitLayers);

  phase("buoy", addBuoySymbolLayer);
  phase("danger", addDangerSymbolLayer);
  phase("light", addLightSymbolLayer);
  phase("depth-contour", addDepthContourLabelLayer);
  phase("sounding", addSoundingLabelLayer);
  phase("light", addLightLabelLayer);
  phase("buoy", addBuoyLabelLayer);
  phase("danger", addDangerLabelLayer);
  // A ruin outranks a place name: it is the reason not to tie up here.
  phase("shoreline-structure", addShorelineStructureRuinLabelLayer);
  phase("mooring", addMooringRuinLabelLayer);
  phase("harbour-facility", addHarbourFacilityLabelLayer);
  phase("anchorage", addAnchorageLabelLayer);
  phase("restricted-area", addRestrictedAreaLabelLayer);
  phase("water-label", addWaterLabelLayer);
  phase("land-label", addLandLabelLayer);

  return layerIds;
}

function addLayer(context: LayerContext, layer: ChartLayerSpecification): string {
  context.map.addLayer(layer, context.beforeId);
  return layer.id;
}

function addCoverageLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-coverage-mask-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "coverage",
    paint: {
      "fill-color": "#d8f3f5",
      "fill-opacity": 1,
      "fill-antialias": false,
    },
  })];
}

function addDepthAreaLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-depth-area-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "depth-area",
    paint: {
      "fill-color": [
        "interpolate", ["linear"], ["coalesce", ["get", "minimumDepth"], 0],
        0, "#b7e6ee",
        12, "#d8f3f5",
      ],
      "fill-opacity": 0.88,
    },
  })];
}

function addDepthContourLineLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-depth-contour-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": "depth-contour",
    paint: { "line-color": "#367a90", "line-width": 1.5 },
  })];
}

function addLandAreaLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-land-area-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "land-area",
    paint: {
      "fill-color": "#efe3bd",
      "fill-opacity": 1,
    },
  })];
}

function addCoastlineLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-coastline-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": "coastline",
    paint: { "line-color": "#282716", "line-width": 3 },
  })];
}

/** Whether a shoreline structure is armouring rather than something to tie to. */
function isArmouring(): ExpressionSpecification {
  return ["match", ["to-string", ["get", "category"]], ARMOURING_CATEGORIES, true, false];
}

function isRuined(): ExpressionSpecification {
  return s57CodeListIncludesExpression("condition", CONDITION_RUINED);
}

/** Picks one value for armouring and another for a structure that can be used. */
function byArmouring(armouring: string | number, structure: string | number): ExpressionSpecification {
  return ["case", isArmouring(), armouring, structure];
}

/** Picks one value for a ruin, and otherwise defers to the armouring split. */
function byCondition(
  ruined: string | number,
  armouring: string | number,
  structure: string | number,
): ExpressionSpecification {
  return ["case", isRuined(), ruined, byArmouring(armouring, structure)];
}

/**
 * Holds armouring back to its own minimum zoom inside a shared layer.
 *
 * A zoom expression has to be the outermost one, so the fade is a `step` over
 * zoom whose two branches are the per-feature values rather than a `case` with a
 * zoom expression buried in one arm, which MapLibre rejects.
 */
function armouringOpacity(opacity: number): ExpressionSpecification {
  return [
    "step", ["zoom"],
    byArmouring(0, 1),
    ARMOURING_MIN_ZOOM, byArmouring(opacity, 1),
  ];
}

/**
 * Docks, piers, breakwaters and the shoreline armouring charted alongside them.
 *
 * Berthing structures — pier, wharf, breakwater, mole, ramp, slipway, pontoon —
 * are drawn solid in the ink of the coastline, so a dock reads as built land a
 * vessel can lie against. Armouring is subdued and appears only once the coast
 * is drawn in detail, because it is not a structure to tie to and drawn alike it
 * would bury the 4,599 piers among 3,671 features of rip rap and sea wall.
 *
 * A ruined structure is greyed, edged with dashes and labelled. The floating dry
 * dock case is carried by the popup, which never calls it a berth.
 */
function addShorelineStructureLayers(context: LayerContext): string[] {
  // The fill is also the area touch target, as on an anchorage. Below the
  // armouring zoom an armouring area still answers a tap, which names it
  // honestly; it is only the drawing that is held back.
  const fillLayerId = addLayer(context, {
    id: `chart-shoreline-structure-fill-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "shoreline-structure",
    minzoom: STRUCTURE_MIN_ZOOM,
    filter: POLYGON_ONLY,
    paint: {
      "fill-color": byCondition(RUIN_FILL, ARMOURING_FILL, STRUCTURE_FILL),
      "fill-opacity": armouringOpacity(ARMOURING_OPACITY),
    },
  });
  addFeatureInteraction(
    context,
    fillLayerId,
    SHORELINE_STRUCTURE_PEER_PREFIX,
    AREA_FEATURE,
    formatShorelineStructureDetails,
  );
  return [
    fillLayerId,
    addLayer(context, {
      id: `chart-shoreline-structure-edge-${context.index}`,
      type: "line",
      source: context.sourceId,
      "source-layer": "shoreline-structure",
      minzoom: STRUCTURE_MIN_ZOOM,
      filter: ["all", POLYGON_ONLY, ["!", isRuined()]],
      paint: {
        "line-color": byArmouring(ARMOURING_INK, STRUCTURE_INK),
        "line-width": byArmouring(0.8, 1.2),
        "line-opacity": armouringOpacity(1),
      },
    }),
    // `line-dasharray` takes no per-feature value in MapLibre, so a ruin needs a
    // layer of its own to be drawn broken rather than solid.
    addLayer(context, {
      id: `chart-shoreline-structure-ruin-edge-${context.index}`,
      type: "line",
      source: context.sourceId,
      "source-layer": "shoreline-structure",
      minzoom: STRUCTURE_MIN_ZOOM,
      filter: ["all", POLYGON_ONLY, isRuined()],
      paint: { "line-color": RUIN_INK, "line-width": 1.2, "line-dasharray": RUIN_DASHES },
    }),
    addLayer(context, {
      id: `chart-shoreline-structure-line-${context.index}`,
      type: "line",
      source: context.sourceId,
      "source-layer": "shoreline-structure",
      minzoom: STRUCTURE_MIN_ZOOM,
      filter: ["all", LINE_ONLY, ["!", isRuined()]],
      paint: {
        // Where the structure is charted as a line, the line is the structure
        // itself and carries its full weight, not an outline's.
        "line-color": byArmouring(ARMOURING_INK, STRUCTURE_INK),
        "line-width": byArmouring(1, 2.4),
        "line-opacity": armouringOpacity(1),
      },
    }),
    addLayer(context, {
      id: `chart-shoreline-structure-ruin-line-${context.index}`,
      type: "line",
      source: context.sourceId,
      "source-layer": "shoreline-structure",
      minzoom: STRUCTURE_MIN_ZOOM,
      filter: ["all", LINE_ONLY, isRuined()],
      paint: { "line-color": RUIN_INK, "line-width": 1.8, "line-dasharray": RUIN_DASHES },
    }),
    addLayer(context, {
      id: `chart-shoreline-structure-point-${context.index}`,
      type: "circle",
      source: context.sourceId,
      "source-layer": "shoreline-structure",
      minzoom: STRUCTURE_MIN_ZOOM,
      filter: POINT_ONLY,
      paint: {
        "circle-radius": 3.2,
        // A ruin is hollow: light inside a grey edge, against the solid dark
        // mark of a structure that is still there.
        "circle-color": byCondition(RUIN_FILL, ARMOURING_FILL, STRUCTURE_INK),
        "circle-stroke-color": byCondition(RUIN_INK, ARMOURING_INK, LABEL_HALO),
        "circle-stroke-width": 1.2,
      },
    }),
  ];
}

/**
 * The dolphins, bollards, pile moorings and mooring buoys of `MORFAC`: small
 * marks, drawn alike whatever their `CATMOR` category, which the popup names.
 * Inventing a symbol per category here would be portrayal this app does not do.
 */
function addMooringLayers(context: LayerContext): string[] {
  const fillLayerId = addLayer(context, {
    id: `chart-mooring-fill-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "mooring",
    minzoom: MOORING_MIN_ZOOM,
    filter: POLYGON_ONLY,
    paint: {
      "fill-color": ["case", isRuined(), RUIN_FILL, STRUCTURE_FILL],
      "fill-opacity": 0.9,
    },
  });
  addFeatureInteraction(context, fillLayerId, MOORING_PEER_PREFIX, AREA_FEATURE, formatMooringDetails);
  return [
    fillLayerId,
    addLayer(context, {
      id: `chart-mooring-line-${context.index}`,
      type: "line",
      source: context.sourceId,
      "source-layer": "mooring",
      minzoom: MOORING_MIN_ZOOM,
      filter: ["all", LINE_ONLY, ["!", isRuined()]],
      paint: { "line-color": STRUCTURE_INK, "line-width": 1.6 },
    }),
    addLayer(context, {
      id: `chart-mooring-ruin-line-${context.index}`,
      type: "line",
      source: context.sourceId,
      "source-layer": "mooring",
      minzoom: MOORING_MIN_ZOOM,
      filter: ["all", LINE_ONLY, isRuined()],
      paint: { "line-color": RUIN_INK, "line-width": 1.4, "line-dasharray": RUIN_DASHES },
    }),
    addLayer(context, {
      id: `chart-mooring-point-${context.index}`,
      type: "circle",
      source: context.sourceId,
      "source-layer": "mooring",
      minzoom: MOORING_MIN_ZOOM,
      filter: POINT_ONLY,
      paint: {
        "circle-radius": 3,
        "circle-color": ["case", isRuined(), RUIN_FILL, STRUCTURE_INK],
        "circle-stroke-color": ["case", isRuined(), RUIN_INK, LABEL_HALO],
        "circle-stroke-width": 1.2,
      },
    }),
  ];
}

/**
 * An anchorage is where anchoring is invited, so it reads as a calm blue wash
 * with a dashed edge, distinct from the warning colours of a restricted area.
 */
function addAnchorageAreaLayers(context: LayerContext): string[] {
  const fillLayerId = addLayer(context, {
    id: `chart-anchorage-fill-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "anchorage",
    paint: { "fill-color": "#4f86b3", "fill-opacity": 0.16 },
  });
  addFeatureInteraction(context, fillLayerId, "chart-anchorage-fill-", AREA_FEATURE, formatAnchorageDetails);
  return [fillLayerId, addLayer(context, {
    id: `chart-anchorage-outline-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": "anchorage",
    paint: { "line-color": "#2f5d8c", "line-width": 1.2, "line-dasharray": [4, 3] },
  })];
}

/**
 * An anchoring restriction has to be legible without opening a popup, so the
 * derived `anchoring` property drives the outline colour and the label text.
 * Prohibited water also carries a red diagonal hatch, which no collision can
 * suppress. The outline itself comes from `restricted-area-edge`.
 */
function addRestrictedAreaLayers(context: LayerContext): string[] {
  // A wash over a restricted area tints the chart under it, and these areas are
  // large: the Apostle Islands National Lakeshore covers most of its cell. The
  // outline and the label carry the meaning instead, leaving the fill as the
  // click target only.
  const fillLayerId = addLayer(context, {
    id: `chart-restricted-area-fill-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "restricted-area",
    paint: { "fill-color": TRANSPARENT },
  });
  addFeatureInteraction(
    context,
    fillLayerId,
    "chart-restricted-area-fill-",
    AREA_FEATURE,
    formatRestrictedAreaDetails,
  );
  addAnchoringPatternImage(context.map);
  return [fillLayerId, addLayer(context, {
    id: `chart-restricted-area-anchoring-${context.index}`,
    type: "fill",
    source: context.sourceId,
    "source-layer": "restricted-area",
    filter: ["==", ["to-string", ["get", "anchoring"]], "prohibited"],
    paint: { "fill-pattern": ANCHORING_PROHIBITED_PATTERN_ID },
  })];
}

/**
 * The outline comes from `restricted-area-edge`, whose cell-boundary cut edges
 * the pipeline has already removed. Drawing it from the polygon instead would
 * put a seam through any area two cells share.
 */
function addRestrictedAreaEdgeLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-restricted-area-edge-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": "restricted-area-edge",
    paint: {
      "line-color": anchoringMatch("#b22222", "#c8781a", "#5a6472"),
      "line-width": anchoringMatch(2.2, 1.8, 1),
    },
  })];
}

/** Picks a value per `anchoring` state: prohibited, restricted, or neither. */
function anchoringMatch(
  prohibited: string | number,
  restricted: string | number,
  other: string | number,
): ExpressionSpecification {
  return [
    "match", ["to-string", ["get", "anchoring"]],
    "prohibited", prohibited,
    "restricted", restricted,
    other,
  ];
}

function addCableLineLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-cable-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": "cable",
    minzoom: DANGER_MIN_ZOOM,
    paint: {
      "line-color": ["match", ["to-string", ["get", "kind"]], "pipeline", "#2f7d6d", "#8a3fb5"],
      "line-width": 1.4,
      "line-dasharray": [4, 2],
    },
  })];
}

function addHarbourFacilityMarkerLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-harbour-facility-marker-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": "harbour-facility",
    minzoom: HARBOUR_MIN_ZOOM,
    paint: {
      "circle-radius": 4.5,
      "circle-color": "#2f5d8c",
      "circle-stroke-color": LABEL_HALO,
      "circle-stroke-width": 1.5,
    },
  })];
}

function addSoundingHitLayer(context: LayerContext): string[] {
  const layerId = addLayer(context, {
    id: `chart-sounding-hit-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": "sounding",
    minzoom: 9,
    paint: {
      "circle-color": TRANSPARENT,
      "circle-radius": 12,
    },
  });
  addFeatureInteraction(context, layerId, "chart-sounding-hit-", POINT_FEATURE, (properties) => formatSoundingDetails(properties, context.displayUnit));
  return [layerId];
}

function addLightHitLayer(context: LayerContext): string[] {
  const layerId = addLayer(context, {
    id: `chart-light-hit-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": "light",
    minzoom: 8,
    paint: {
      "circle-color": TRANSPARENT,
      "circle-radius": 16,
    },
  });
  addFeatureInteraction(context, layerId, "chart-light-hit-", POINT_FEATURE, formatLightDetails);
  return [layerId];
}

function addBuoyHitLayer(context: LayerContext): string[] {
  const layerId = addLayer(context, {
    id: `chart-buoy-hit-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": "buoy",
    minzoom: BUOY_MIN_ZOOM,
    paint: { "circle-color": TRANSPARENT, "circle-radius": 16 },
  });
  addFeatureInteraction(context, layerId, "chart-buoy-hit-", POINT_FEATURE, formatBuoyDetails);
  return [layerId];
}

function addDangerHitLayer(context: LayerContext): string[] {
  const layerId = addLayer(context, {
    id: `chart-danger-hit-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": "danger",
    minzoom: DANGER_MIN_ZOOM,
    paint: { "circle-color": TRANSPARENT, "circle-radius": 16 },
  });
  const displayUnit = context.displayUnit;
  addFeatureInteraction(
    context,
    layerId,
    "chart-danger-hit-",
    POINT_FEATURE,
    (properties) => formatDangerDetails(properties, displayUnit),
  );
  return [layerId];
}

function addHarbourFacilityHitLayer(context: LayerContext): string[] {
  const layerId = addLayer(context, {
    id: `chart-harbour-facility-hit-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": "harbour-facility",
    minzoom: HARBOUR_MIN_ZOOM,
    paint: { "circle-color": TRANSPARENT, "circle-radius": 16 },
  });
  addFeatureInteraction(
    context,
    layerId,
    "chart-harbour-facility-hit-",
    POINT_FEATURE,
    formatHarbourFacilityDetails,
  );
  return [layerId];
}

function addCableHitLayer(context: LayerContext): string[] {
  const layerId = addLayer(context, {
    id: `chart-cable-hit-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": "cable",
    minzoom: DANGER_MIN_ZOOM,
    paint: { "line-color": TRANSPARENT, "line-width": 16 },
  });
  addFeatureInteraction(context, layerId, "chart-cable-hit-", LINE_FEATURE, formatCableDetails);
  return [layerId];
}

/**
 * Touch targets for the line and point primitives of a structure layer. The area
 * primitive is answered by its own fill, which is already the size of the tap.
 *
 * All three share one peer prefix, so a pier charted as an area in one cell and
 * as a line in another yields a single popup, and the most specific primitive
 * under the tap is the one that wins.
 */
function addStructureHitLayers(
  context: LayerContext,
  sourceLayer: "shoreline-structure" | "mooring",
  peerPrefix: string,
  minzoom: number,
  format: (properties: ChartFeatureProperties) => string,
): string[] {
  const lineLayerId = addLayer(context, {
    id: `${peerPrefix}hit-line-${context.index}`,
    type: "line",
    source: context.sourceId,
    "source-layer": sourceLayer,
    minzoom,
    filter: LINE_ONLY,
    paint: { "line-color": TRANSPARENT, "line-width": 16 },
  });
  addFeatureInteraction(context, lineLayerId, peerPrefix, LINE_FEATURE, format);
  const pointLayerId = addLayer(context, {
    id: `${peerPrefix}hit-point-${context.index}`,
    type: "circle",
    source: context.sourceId,
    "source-layer": sourceLayer,
    minzoom,
    filter: POINT_ONLY,
    paint: { "circle-color": TRANSPARENT, "circle-radius": 16 },
  });
  addFeatureInteraction(context, pointLayerId, peerPrefix, POINT_FEATURE, format);
  return [lineLayerId, pointLayerId];
}

function addShorelineStructureHitLayers(context: LayerContext): string[] {
  return addStructureHitLayers(
    context,
    "shoreline-structure",
    SHORELINE_STRUCTURE_PEER_PREFIX,
    STRUCTURE_MIN_ZOOM,
    formatShorelineStructureDetails,
  );
}

function addMooringHitLayers(context: LayerContext): string[] {
  return addStructureHitLayers(
    context,
    "mooring",
    MOORING_PEER_PREFIX,
    MOORING_MIN_ZOOM,
    formatMooringDetails,
  );
}

/**
 * Names a ruin on the chart itself. `CONDTN` 2 is the dock ruin the Apostle
 * Islands are full of, and a mariner must not have to open a popup to find out
 * that the pier ahead is one. The word is placed over the feature whatever its
 * primitive, so one layer covers all three.
 */
function addRuinLabelLayer(
  context: LayerContext,
  sourceLayer: "shoreline-structure" | "mooring",
  peerPrefix: string,
): string[] {
  return [addLayer(context, {
    id: `${peerPrefix}ruin-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": sourceLayer,
    minzoom: RUIN_LABEL_MIN_ZOOM,
    filter: isRuined(),
    layout: {
      "text-field": "Ruin",
      "text-font": CHART_FONT,
      "text-size": 10,
      "text-allow-overlap": false,
      "text-padding": 3,
    },
    paint: {
      "text-color": RUIN_LABEL_COLOR,
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

function addShorelineStructureRuinLabelLayer(context: LayerContext): string[] {
  return addRuinLabelLayer(context, "shoreline-structure", SHORELINE_STRUCTURE_PEER_PREFIX);
}

function addMooringRuinLabelLayer(context: LayerContext): string[] {
  return addRuinLabelLayer(context, "mooring", MOORING_PEER_PREFIX);
}

/**
 * Buoys are drawn before every label and keep their place in the collision
 * index, so a name can never be placed over an aid to navigation.
 */
function addBuoySymbolLayer(context: LayerContext): string[] {
  addBuoyImages(context.map);
  return [addLayer(context, {
    id: `chart-buoy-symbol-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "buoy",
    minzoom: BUOY_MIN_ZOOM,
    layout: {
      "icon-image": buoyIconExpression(),
      "icon-size": 0.85,
      // The buoy body floats above its charted position.
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
    },
  })];
}

function addDangerSymbolLayer(context: LayerContext): string[] {
  addDangerImages(context.map);
  return [addLayer(context, {
    id: `chart-danger-symbol-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "danger",
    minzoom: DANGER_MIN_ZOOM,
    layout: {
      "icon-image": dangerIconExpression(),
      "icon-size": 0.85,
      "icon-allow-overlap": true,
    },
  })];
}

function addLightSymbolLayer(context: LayerContext): string[] {
  addLightFlareImages(context.map);
  return [addLayer(context, {
    id: `chart-light-symbol-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "light",
    minzoom: 8,
    layout: {
      "icon-image": lightFlareIconExpression(),
      // The flare's sharp tip is the charted light position.
      "icon-anchor": "bottom-left",
      // Keep the flare visible even when its descriptive label collides
      // with another chart annotation.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  })];
}

function addDepthContourLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-depth-contour-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "depth-contour",
    minzoom: CONTOUR_LABEL_MIN_ZOOM,
    // The zero curve is the low-water line, which a chart draws but does not
    // label. `to-number` turns an absent depth into zero, dropping it too.
    filter: [">", ["to-number", ["get", "depth"]], 0],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 250,
      "text-field": contourLabelExpression(context.displayUnit),
      "text-font": CHART_FONT,
      "text-size": 11,
      "text-padding": 3,
      "text-keep-upright": true,
    },
    paint: {
      "text-color": "#367a90",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 2,
    },
  })];
}

function addSoundingLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-sounding-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "sounding",
    minzoom: 9,
    layout: {
      "text-field": soundingLabelExpression(context.displayUnit),
      "text-font": CHART_FONT,
      "text-size": 12,
      "text-allow-overlap": false,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#173948",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

function addLightLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-light-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "light",
    minzoom: 8,
    layout: {
      "text-field": lightLabelExpression(),
      "text-font": CHART_FONT,
      "text-size": 12,
      // Prefer the anchors that keep the label clear of the flare above and right of the light.
      "text-variable-anchor": ["right", "top-right", "top", "top-left", "bottom-right", "left"],
      "text-radial-offset": 1,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#b00078",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

function addBuoyLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-buoy-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "buoy",
    minzoom: BUOY_LABEL_MIN_ZOOM,
    layout: {
      // An unnamed buoy shows its symbol alone.
      "text-field": ["coalesce", ["get", "name"], ""],
      "text-font": CHART_FONT,
      "text-size": 11,
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.9,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#0f3d52",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

/** A sounded danger carries its depth the way a sounding does. */
function addDangerLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-danger-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "danger",
    minzoom: DANGER_LABEL_MIN_ZOOM,
    layout: {
      "text-field": [
        "case",
        ["==", ["typeof", ["get", "depth"]], "number"],
        soundingLabelExpression(context.displayUnit),
        "",
      ],
      "text-font": CHART_FONT,
      "text-size": 11,
      "text-variable-anchor": ["right", "left", "bottom", "top"],
      "text-radial-offset": 0.8,
      "text-allow-overlap": false,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#1b1b1b",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

function addHarbourFacilityLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-harbour-facility-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "harbour-facility",
    minzoom: HARBOUR_MIN_ZOOM,
    layout: {
      "text-field": ["coalesce", ["get", "name"], ""],
      "text-font": CHART_FONT,
      "text-size": 11,
      "text-max-width": 9,
      "text-variable-anchor": ["top", "bottom", "left", "right"],
      "text-radial-offset": 0.8,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#1f4a73",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

function addAnchorageLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-anchorage-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "anchorage",
    minzoom: AREA_LABEL_MIN_ZOOM,
    layout: {
      "text-field": ["coalesce", ["get", "name"], "Anchorage"],
      "text-font": CHART_FONT,
      "text-size": 11,
      "text-max-width": 9,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#2f5d8c",
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

/**
 * The anchoring rule is the label, not the area's name, wherever one applies:
 * a navigator should read the restriction off the chart without tapping it.
 */
function addRestrictedAreaLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `chart-restricted-area-label-${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "restricted-area",
    minzoom: AREA_LABEL_MIN_ZOOM,
    layout: {
      "text-field": [
        "case",
        ["==", ["to-string", ["get", "anchoring"]], "prohibited"], "Anchoring prohibited",
        ["==", ["to-string", ["get", "anchoring"]], "restricted"], "Anchoring restricted",
        ["coalesce", ["get", "name"], [
          "match", ["to-string", ["get", "kind"]],
          "cable-area", "Cable area",
          "pipeline-area", "Pipeline area",
          "Restricted area",
        ]],
      ],
      "text-font": CHART_FONT,
      "text-size": 11,
      "text-max-width": 9,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": [
        "match", ["to-string", ["get", "anchoring"]],
        "prohibited", "#8f1b1b",
        "restricted", "#96580f",
        "#4a5563",
      ],
      "text-halo-color": LABEL_HALO,
      "text-halo-width": 1.5,
    },
  })];
}

/**
 * Water names reuse the landform band: both layers carry `spanDegrees` with the
 * same meaning, so a bay is named over the same range of zooms an island is.
 * Charts set water names in italic; with a single font weight available the
 * distinction is carried by colour and by capitals instead.
 */
function addWaterLabelLayer(context: LayerContext): string[] {
  return [addLayer(context, {
    id: `${WATER_LABEL_LAYER_PREFIX}${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "water-label",
    filter: landLabelFilter(),
    layout: {
      "text-field": ["get", "name"],
      "text-font": CHART_FONT,
      "text-size": 12,
      "text-transform": "uppercase",
      "text-letter-spacing": 0.14,
      "text-max-width": 9,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#1f6b86",
      "text-halo-color": "#eaf7fb",
      "text-halo-width": 1.5,
    },
  })];
}

/**
 * Added last so soundings, lights, aids and hazards all take collision priority
 * over place names. A settlement is not a landform: it is set smaller and in the
 * near-black of a built-up area, against the brown of a physical feature.
 */
function addLandLabelLayer(context: LayerContext): string[] {
  const bySettlement = (
    settlement: string | number,
    landform: string | number,
  ): ExpressionSpecification => [
    "match", ["to-string", ["get", "kind"]],
    "settlement", settlement,
    landform,
  ];
  return [addLayer(context, {
    id: `${LAND_LABEL_LAYER_PREFIX}${context.index}`,
    type: "symbol",
    source: context.sourceId,
    "source-layer": "land-label",
    filter: landLabelFilter(),
    layout: {
      "text-field": ["get", "name"],
      "text-font": CHART_FONT,
      "text-size": bySettlement(11, 13),
      "text-letter-spacing": bySettlement(0.05, 0),
      "text-max-width": 8,
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": bySettlement("#2b2b2b", "#4a4128"),
      "text-halo-color": bySettlement("#f7f2e3", "#efe3bd"),
      "text-halo-width": 1.5,
    },
  })];
}

function lightLabelExpression(): ExpressionSpecification {
  const optionalNumber = (property: string, suffix: string): ExpressionSpecification => [
    "case",
    ["==", ["typeof", ["get", property]], "number"],
    ["concat", " ", ["number-format", ["get", property], { "max-fraction-digits": 1 }], suffix],
    "",
  ];
  return [
    "concat",
    [
      "match", ["to-string", ["get", "characteristic"]],
      "1", "F", "2", "Fl", "3", "LFl", "4", "Q", "5", "VQ", "6", "UQ",
      "7", "Iso", "8", "Oc", "9", "IQ", "10", "IVQ", "11", "IUQ", "12", "Mo",
      "13", "F.Fl", "14", "F.LFl", "15", "Oc.Fl", "16", "Oc.LFl", "17", "Al.Oc",
      "18", "Al.LFl", "19", "Al.Fl", "20", "Al.Gr", "21", "2F Vert", "22", "2F Hor",
      "23", "3F Vert", "24", "3F Hor", "25", "Q+LFl", "26", "VQ+LFl",
      "27", "UQ+LFl", "28", "Al", "29", "F.Al.Fl", "Lt",
    ],
    [
      "match", ["to-string", ["get", "signalGroup"]],
      "", "", "()", "", "( )", "", "(1)", "", "1", "",
      ["to-string", ["get", "signalGroup"]],
    ],
    [
      "case",
      ["has", "color"],
      ["concat", " ", [
        "match", ["downcase", ["to-string", ["get", "color"]]],
        "white", "W", "red", "R", "green", "G", "blue", "Bu", "yellow", "Y",
        "amber", "Am", "violet", "Vi", "orange", "Or",
        "1", "W", "3", "R", "4", "G", "5", "Bu", "6", "Y", "9", "Am", "10", "Vi", "11", "Or",
        "[ \"1\" ]", "W", "[ \"3\" ]", "R", "[ \"4\" ]", "G", "[ \"5\" ]", "Bu",
        "[ \"6\" ]", "Y", "[ \"9\" ]", "Am", "[ \"10\" ]", "Vi", "[ \"11\" ]", "Or",
        "[\"1\"]", "W", "[\"3\"]", "R", "[\"4\"]", "G", "[\"5\"]", "Bu",
        "[\"6\"]", "Y", "[\"9\"]", "Am", "[\"10\"]", "Vi", "[\"11\"]", "Or",
        "[ \"1\", \"3\" ]", "W R", "[ \"1\", \"4\" ]", "W G",
        ["to-string", ["get", "color"]],
      ]],
      "",
    ],
    optionalNumber("periodSeconds", "s"),
    optionalNumber("heightMetres", "m"),
    optionalNumber("nominalRangeNm", "M"),
  ];
}

function positionLayerId(map: MapLibreMap): string | undefined {
  if (map.getLayer(POSITION_ACCURACY_LAYER_ID)) return POSITION_ACCURACY_LAYER_ID;
  if (map.getLayer(POSITION_FIX_LAYER_ID)) return POSITION_FIX_LAYER_ID;
  return undefined;
}

function soundingLabelExpression(unit: DepthUnit): ExpressionSpecification {
  return [
    "number-format",
    ["*", ["get", "depth"], depthConversionFactor(unit)],
    { "min-fraction-digits": 1, "max-fraction-digits": 1 },
  ];
}

/**
 * Charted foot and fathom curves are whole units. NOAA stores them converted to
 * metres, so the 6 ft curve arrives as 1.8 m; rounding recovers what the chart
 * calls it. A metric curve keeps a decimal, where 1.8 m is the value itself.
 * `number-format` cannot do this: it ignores a zero fraction-digit option.
 */
export function contourLabelExpression(unit: DepthUnit): ExpressionSpecification {
  const converted: ExpressionSpecification = ["*", ["get", "depth"], depthConversionFactor(unit)];
  return unit === "metre"
    ? ["number-format", converted, { "min-fraction-digits": 1, "max-fraction-digits": 1 }]
    : ["to-string", ["round", converted]];
}

export function addDemoChartLayers(map: MapLibreMap): void {
  map.addSource(DEMO_SOURCE_IDS.depthArea, { type: "geojson", data: demoDepthAreas });
  map.addLayer({
    id: "depth-area-fill",
    type: "fill",
    source: DEMO_SOURCE_IDS.depthArea,
    paint: {
      "fill-color": [
        "interpolate", ["linear"], ["get", "minimumDepth"],
        0, "#b7e6ee",
        12, "#d8f3f5",
      ],
      "fill-opacity": 0.88,
    },
  });

  map.addSource(DEMO_SOURCE_IDS.depthContour, { type: "geojson", data: demoDepthContours });
  map.addLayer({
    id: "depth-contour-line",
    type: "line",
    source: DEMO_SOURCE_IDS.depthContour,
    paint: { "line-color": "#367a90", "line-width": 1.5 },
  });

  map.addSource(DEMO_SOURCE_IDS.coastline, { type: "geojson", data: demoCoastline });
  map.addLayer({
    id: "coastline-line",
    type: "line",
    source: DEMO_SOURCE_IDS.coastline,
    paint: { "line-color": "#282716", "line-width": 3 },
  });

  map.addSource(DEMO_SOURCE_IDS.sounding, { type: "geojson", data: demoSoundings });
  map.addLayer({
    id: "sounding-point",
    type: "circle",
    source: DEMO_SOURCE_IDS.sounding,
    minzoom: 9,
    paint: {
      "circle-color": "#173948",
      "circle-radius": 5,
      "circle-stroke-color": "#f5fbfc",
      "circle-stroke-width": 1.5,
    },
  });

  map.on("mouseenter", "sounding-point", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "sounding-point", () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", "sounding-point", (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    const depth = feature?.properties?.depth;
    if (typeof depth !== "number") return;

    new Popup({ closeButton: true, focusAfterOpen: true })
      .setLngLat(event.lngLat)
      .setText(`${depth.toFixed(1)} metres`)
      .addTo(map);
  });
}

function formatSoundingDetails(properties: ChartFeatureProperties, displayUnit: DepthUnit): string {
  const depth = properties.depth;
  if (typeof depth !== "number") return "";
  return `${formatDepthInUnit(depth, displayUnit)} ${depthUnitLabel(displayUnit)}`;
}

/**
 * Registers a layer as tappable. The popup is opened by the single handler in
 * `addPopupDispatcher`, so a tap landing on a sounding inside a restricted area
 * describes the sounding instead of stacking two popups over each other.
 */
function addFeatureInteraction(
  context: LayerContext,
  layerId: string,
  peerPrefix: string,
  precedence: number,
  format: (properties: ChartFeatureProperties) => string,
): void {
  const { map } = context;
  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });
  context.interactions.push({ layerId, peerPrefix, precedence, format });
}

function addPopupDispatcher(map: MapLibreMap, interactions: readonly ChartInteraction[]): void {
  map.on("click", (event: MapLayerMouseEvent) => {
    const chosen = chooseInteraction(map.queryRenderedFeatures(event.point), interactions);
    if (chosen === undefined) return;
    const details = formatFeatureDetailsList(chosen.properties, chosen.interaction.format);
    if (details === "") return;
    new Popup({ closeButton: true, focusAfterOpen: true })
      .setLngLat(event.lngLat)
      .setText(details)
      .addTo(map);
  });
}
