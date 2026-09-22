import type { DepthUnit } from "../chart-package";
import { depthUnitLabel, formatDepthInUnit } from "./depth";
import { describeS57CodeList, type S57Attribute } from "./s57-codes";

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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
}
