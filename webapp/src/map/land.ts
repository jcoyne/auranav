import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";

/** MapLibre lays the world out in 512-pixel tiles, doubling with each zoom level. */
const PIXELS_PER_DEGREE_AT_ZOOM_0 = 512 / 360;

/**
 * Landform labels are unsized point anchors, so nothing about the label itself
 * says how big the landform is. Without a band, every named landform in a cell
 * would claim a label at every zoom: the mainland would stay labelled while
 * zoomed into a harbour, and islets would be named while still a few pixels wide.
 */
export const MINIMUM_LABEL_PIXELS = 80;
export const MAXIMUM_LABEL_PIXELS = 4096;

/** Matches the pipeline's floor for landforms with no extent of their own. */
export const MINIMUM_LABEL_SPAN_DEGREES = 0.005;

/** The landform's on-screen width in pixels at the given zoom. */
export function landLabelPixelWidth(spanDegrees: number, zoom: number): number {
  return Math.max(spanDegrees, MINIMUM_LABEL_SPAN_DEGREES) * 2 ** zoom * PIXELS_PER_DEGREE_AT_ZOOM_0;
}

/**
 * Shows a landform's name only while the landform reads at screen size. The
 * comparison is in log2 space because that is where `zoom` is already linear.
 * MapLibre re-evaluates `zoom` in a filter only at integer zoom levels, so
 * labels enter and leave the band on whole zoom steps.
 */
export function landLabelFilter(): FilterSpecification {
  return [
    "all",
    [">=", log2PixelWidth(), Math.log2(MINIMUM_LABEL_PIXELS)],
    ["<", log2PixelWidth(), Math.log2(MAXIMUM_LABEL_PIXELS)],
  ];
}

function log2PixelWidth(): ExpressionSpecification {
  return [
    "+",
    // A missing span converts to zero, which the floor then lifts to the
    // default; `log2` of zero would be negative infinity.
    ["log2", ["max", ["to-number", ["get", "spanDegrees"]], MINIMUM_LABEL_SPAN_DEGREES]],
    ["zoom"],
    Math.log2(PIXELS_PER_DEGREE_AT_ZOOM_0),
  ];
}
