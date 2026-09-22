import type { DepthUnit } from "../chart-package";
import { depthUnitLabel, formatDepthInUnit } from "./depth";
import {
  describeS57CodeList,
  FUNCTION_LIGHT_SUPPORT,
  s57CodeListIncludes,
  VISUALLY_CONSPICUOUS,
  type S57Attribute,
} from "./s57-codes";

/**
 * Popup text for the aid, hazard and area layers.
 *
 * Every S-57 code is resolved through `s57-codes`, which prints a code it has no
 * entry for as the bare code. A popup therefore never states a meaning the
 * published tables do not give.
 */

export type ChartFeatureProperties = Record<string, unknown>;

const BUOY_HEADINGS: Readonly<Record<string, string>> = {
  lateral: "Lateral buoy",
  cardinal: "Cardinal buoy",
  "safe-water": "Safe water buoy",
  "isolated-danger": "Isolated danger buoy",
  "special-purpose": "Special purpose buoy",
};

/** The category attribute differs with the buoy class the feature came from. */
const BUOY_CATEGORY_ATTRIBUTES: Readonly<Record<string, S57Attribute>> = {
  lateral: "CATLAM",
  cardinal: "CATCAM",
  "special-purpose": "CATSPM",
};

const DANGER_HEADINGS: Readonly<Record<string, string>> = {
  wreck: "Wreck",
  obstruction: "Obstruction",
  rock: "Rock",
};

const RESTRICTED_AREA_HEADINGS: Readonly<Record<string, string>> = {
  "cable-area": "Cable area",
  "restricted": "Restricted area",
  "pipeline-area": "Pipeline area",
};

const CABLE_HEADINGS: Readonly<Record<string, string>> = {
  cable: "Submarine cable",
  pipeline: "Submarine pipeline",
};

/**
 * A `FLODOC` is a floating dry dock: a shipyard structure that is not a berth,
 * and must not be described as one. It gets a heading of its own rather than
 * sharing the pontoon's, which is the floating dock a vessel does lie against.
 */
const SHORELINE_STRUCTURE_HEADINGS: Readonly<Record<string, string>> = {
  construction: "Shoreline structure",
  pontoon: "Pontoon",
  "floating-dock": "Floating dry dock",
};

/** `CATSLC` belongs to `SLCONS`; S-57 gives no category to the other two classes. */
const CATEGORISED_STRUCTURE_KINDS = ["construction"];

const ANCHORING_HEADINGS: Readonly<Record<string, string>> = {
  prohibited: "Anchoring prohibited",
  restricted: "Anchoring restricted",
};

export function formatBuoyDetails(properties: ChartFeatureProperties): string {
  const kind = text(properties.kind);
  const heading = (kind === undefined ? undefined : BUOY_HEADINGS[kind]) ?? "Buoy";
  const categoryAttribute = kind === undefined ? undefined : BUOY_CATEGORY_ATTRIBUTES[kind];
  return lines([
    text(properties.name) ?? heading,
    text(properties.name) === undefined ? undefined : heading,
    categoryAttribute === undefined
      ? undefined
      : labelled("Category", describeS57CodeList(categoryAttribute, properties.category)),
    labelled("Shape", describeS57CodeList("BOYSHP", properties.shape)),
    labelled("Color", describeS57CodeList("COLOUR", properties.color)),
    labelled("Color pattern", describeS57CodeList("COLPAT", properties.colorPattern)),
  ]);
}

export function formatDangerDetails(
  properties: ChartFeatureProperties,
  displayUnit: DepthUnit,
): string {
  const kind = text(properties.kind);
  const heading = (kind === undefined ? undefined : DANGER_HEADINGS[kind]) ?? "Danger";
  const categoryAttribute: S57Attribute = kind === "wreck" ? "CATWRK" : "CATOBS";
  const depth = finiteNumber(properties.depth);
  return lines([
    text(properties.name) ?? heading,
    text(properties.name) === undefined ? undefined : heading,
    kind === "rock"
      ? undefined
      : labelled("Category", describeS57CodeList(categoryAttribute, properties.category)),
    depth === undefined
      ? undefined
      : `Depth: ${formatDepthInUnit(depth, displayUnit)} ${depthUnitLabel(displayUnit)}`,
    labelled("Water level", describeS57CodeList("WATLEV", properties.waterLevel)),
    labelled("Sounding quality", describeS57CodeList("QUASOU", properties.soundingQuality)),
  ]);
}

export function formatHarbourFacilityDetails(properties: ChartFeatureProperties): string {
  return lines([
    text(properties.name) ?? "Harbour facility",
    labelled("Facility", describeS57CodeList("CATHAF", properties.category)),
  ]);
}

export function formatAnchorageDetails(properties: ChartFeatureProperties): string {
  return lines([
    text(properties.name) ?? "Anchorage",
    labelled("Category", describeS57CodeList("CATACH", properties.category)),
  ]);
}

export function formatRestrictedAreaDetails(properties: ChartFeatureProperties): string {
  const kind = text(properties.kind);
  const heading = (kind === undefined ? undefined : RESTRICTED_AREA_HEADINGS[kind]) ?? "Restricted area";
  const anchoring = text(properties.anchoring);
  return lines([
    text(properties.name) ?? heading,
    text(properties.name) === undefined ? undefined : heading,
    // Repeated from the map itself so the anchoring rule leads the popup.
    anchoring === undefined ? undefined : ANCHORING_HEADINGS[anchoring] ?? `Anchoring ${anchoring}`,
    labelled("Restrictions", describeS57CodeList("RESTRN", properties.restriction)),
    labelled("Category", describeS57CodeList("CATREA", properties.category)),
    // S-57 never published codes 16 through 27, so a restriction can reach the
    // chart with no known meaning. NOAA cites the governing regulation here,
    // which is the only account of it available.
    labelled("Authority", text(properties.information)),
  ]);
}

export function formatCableDetails(properties: ChartFeatureProperties): string {
  const kind = text(properties.kind);
  const heading = (kind === undefined ? undefined : CABLE_HEADINGS[kind]) ?? "Submarine cable";
  const categoryAttribute: S57Attribute = kind === "pipeline" ? "CATPIP" : "CATCBL";
  return lines([
    text(properties.name) ?? heading,
    text(properties.name) === undefined ? undefined : heading,
    labelled("Category", describeS57CodeList(categoryAttribute, properties.category)),
  ]);
}

/**
 * A dock, pier, breakwater or shoreline revetment.
 *
 * The condition leads the attributes because code 2 is `ruined`, and the
 * Apostle Islands carry plenty of logging-era dock ruins: a mariner reading this
 * popup to decide whether to tie up has to meet that first.
 */
export function formatShorelineStructureDetails(properties: ChartFeatureProperties): string {
  const kind = text(properties.kind);
  const heading = (kind === undefined ? undefined : SHORELINE_STRUCTURE_HEADINGS[kind])
    ?? "Shoreline structure";
  return lines([
    text(properties.name) ?? heading,
    text(properties.name) === undefined ? undefined : heading,
    labelled("Condition", describeS57CodeList("CONDTN", properties.condition)),
    kind !== undefined && !CATEGORISED_STRUCTURE_KINDS.includes(kind)
      ? undefined
      : labelled("Category", describeS57CodeList("CATSLC", properties.category)),
    labelled("Water level", describeS57CodeList("WATLEV", properties.waterLevel)),
  ]);
}

/**
 * How a landmark's own height is labelled.
 *
 * `landmark.heightMetres` is the height of the structure; `light.heightMetres`
 * is the elevation of the light's focal plane above its vertical datum. A
 * lighthouse carries both, measured from different places to different places,
 * so neither popup may say a bare "Height" and the two labels are kept apart
 * deliberately. `LIGHT_HEIGHT_LABEL` in `light.ts` is the other half of this.
 */
export const LANDMARK_HEIGHT_LABEL = "Structure height";

/**
 * A tower, mast, chimney, spire or dome ashore — and the lighthouse structures,
 * which S-57 charts as an `LNDMRK` whose `FUNCTN` is 33, at the same position as
 * the `LIGHTS` object it carries.
 *
 * The heading comes from the function and not from the category, because a
 * light is carried by a chimney and by a dome as well as by a tower. `FUNCTN`
 * is a code list, so a light support may arrive as `"30,33"`.
 */
export function formatLandmarkDetails(properties: ChartFeatureProperties): string {
  const name = text(properties.name);
  const heading = s57CodeListIncludes(properties.function, FUNCTION_LIGHT_SUPPORT)
    ? "Light support"
    : "Landmark";
  // Sparse in the source: most landmarks carry no HEIGHT at all, and an absent
  // one drops its line rather than printing an empty measurement.
  const height = finiteNumber(properties.heightMetres);
  return lines([
    name ?? heading,
    name === undefined ? undefined : heading,
    // What makes a landmark usable for a bearing leads the rest.
    s57CodeListIncludes(properties.conspicuous, VISUALLY_CONSPICUOUS)
      ? "Visually conspicuous"
      : undefined,
    labelled("Category", describeS57CodeList("CATLMK", properties.category)),
    labelled("Function", describeS57CodeList("FUNCTN", properties.function)),
    height === undefined
      ? undefined
      : `${LANDMARK_HEIGHT_LABEL}: ${formatMetres(height)} metres`,
  ]);
}

/** A dolphin, bollard, pile mooring or mooring buoy. */
export function formatMooringDetails(properties: ChartFeatureProperties): string {
  return lines([
    text(properties.name) ?? "Mooring facility",
    text(properties.name) === undefined ? undefined : "Mooring facility",
    labelled("Condition", describeS57CodeList("CONDTN", properties.condition)),
    labelled("Category", describeS57CodeList("CATMOR", properties.category)),
    labelled("Water level", describeS57CodeList("WATLEV", properties.waterLevel)),
  ]);
}

/**
 * One popup for every feature under the tap, with duplicates dropped: coarse and
 * detailed cells can both hold the same aid.
 */
export function formatFeatureDetailsList(
  features: readonly ChartFeatureProperties[],
  format: (properties: ChartFeatureProperties) => string,
): string {
  return [...new Set(features.map(format))].join("\n\n");
}

function labelled(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${label}: ${value}`;
}

function lines(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join("\n");
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function formatMetres(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
}
