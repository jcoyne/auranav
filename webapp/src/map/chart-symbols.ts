import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import {
  disc,
  ICON_PIXEL_RATIO,
  insetPolygon,
  polygon,
  renderIcon,
  ring,
  stroke,
  union,
  type IconShape,
  type Point,
  type Rgb,
} from "./raster-icon";
import {
  firstS57CodeExpression,
  FUNCTION_LIGHT_SUPPORT,
  s57CodeListIncludesExpression,
} from "./s57-codes";

/**
 * Buoy, danger and restricted-area symbols, generated at runtime.
 *
 * These are deliberately plain shapes chosen for legibility at chart scale. They
 * are not IHO S-52 portrayal and must not be read as chart-standard symbols: a
 * buoy takes the outline of its `BOYSHP` shape and the first of its `COLOUR`
 * codes, and a danger takes one of three marks by kind.
 */

/** The side of a buoy or danger icon, in style pixels. */
export const CHART_ICON_SIZE = 16;

const OUTLINE: Rgb = [26, 26, 26];
const CASING: Rgb = [252, 252, 252];

export type BuoyShapeKey = "cone" | "can" | "sphere" | "pillar";
export type BuoyColorKey = "red" | "green" | "yellow" | "black" | "white" | "other";

const BUOY_SHAPE_KEYS: readonly BuoyShapeKey[] = ["cone", "can", "sphere", "pillar"];
const BUOY_COLOR_KEYS: readonly BuoyColorKey[] = [
  "red", "green", "yellow", "black", "white", "other",
];

/**
 * A buoy whose `COLOUR` code has no symbol colour of its own draws grey rather
 * than borrowing the meaning of a colour it does not have.
 */
const BUOY_COLORS: Record<BuoyColorKey, Rgb> = {
  red: [203, 42, 47],
  green: [0, 148, 94],
  yellow: [243, 198, 24],
  black: [34, 34, 34],
  white: [250, 250, 250],
  other: [124, 124, 124],
};

/** Every buoy shape but the sphere, which is a disc rather than a polygon. */
const BUOY_POLYGONS: Record<Exclude<BuoyShapeKey, "sphere">, readonly Point[]> = {
  // A nun, drawn as the cone it is.
  cone: [[8, 2], [13.5, 14], [2.5, 14]],
  can: [[3.5, 3.5], [12.5, 3.5], [12.5, 14], [3.5, 14]],
  // A spar or pillar: a narrow upright body on a short base.
  pillar: [[5.5, 2], [10.5, 2], [10.5, 11.5], [12.5, 14], [3.5, 14]],
};

export type DangerKind = "wreck" | "obstruction" | "rock";

export const DANGER_IMAGE_IDS: Record<DangerKind, string> = {
  wreck: "chart-danger-wreck",
  obstruction: "chart-danger-obstruction",
  rock: "chart-danger-rock",
};

/**
 * The `LNDMRK` shapes. A landmark is drawn as an outline rather than a filled
 * body: these are structures ashore, not aids afloat, and an outline stays
 * legible over the land fill it stands on.
 *
 * `light-support` is the tower of a lighthouse. It is keyed off `FUNCTN` 33 and
 * not off any category, because a light is carried by a chimney or a dome as
 * well as by a tower, and it is drawn in the magenta a chart reserves for
 * lights so that the tower, the flare and the light label read as one object.
 */
export type LandmarkShapeKey =
  | "tower" | "mast" | "chimney" | "spire" | "dome" | "mark" | "light-support";

const LANDMARK_SHAPE_KEYS: readonly LandmarkShapeKey[] = [
  "tower", "mast", "chimney", "spire", "dome", "mark", "light-support",
];

/** The magenta a chart uses for lights, matching the light label. */
const LIGHT_INK: Rgb = [176, 0, 120];

/** The red hatch that marks water where anchoring is prohibited. */
export const ANCHORING_PROHIBITED_PATTERN_ID = "chart-anchoring-prohibited-hatch";
export const ANCHORING_PATTERN_SIZE = 16;
const ANCHORING_PATTERN_PIXEL_RATIO = 2;
const HATCH_COLOR: Rgb = [178, 34, 34];
/** The stripe period divides the tile, so the pattern repeats without a seam. */
const HATCH_PERIOD = 8;
const HATCH_WIDTH = 3;

export function buoyImageId(shape: BuoyShapeKey, color: BuoyColorKey): string {
  return `chart-buoy-${shape}-${color}`;
}

/** Rasterizes one buoy: a dark outline with the buoy's colour inside it. */
export function renderBuoyIcon(
  shape: BuoyShapeKey,
  color: BuoyColorKey,
  pixelRatio: number = ICON_PIXEL_RATIO,
): ReturnType<typeof renderIcon> {
  const fill = BUOY_COLORS[color];
  const shapes: IconShape[] = shape === "sphere"
    ? [
      { color: OUTLINE, covers: disc(8, 8.5, 5.6) },
      { color: fill, covers: disc(8, 8.5, 4.4) },
    ]
    : [
      { color: OUTLINE, covers: polygon(BUOY_POLYGONS[shape]) },
      { color: fill, covers: polygon(insetPolygon(BUOY_POLYGONS[shape], 0.74)) },
    ];
  return renderIcon(CHART_ICON_SIZE, shapes, pixelRatio);
}

/** Rasterizes one danger mark: a dark symbol with a light casing behind it. */
export function renderDangerIcon(
  kind: DangerKind,
  pixelRatio: number = ICON_PIXEL_RATIO,
): ReturnType<typeof renderIcon> {
  const mark = dangerMark(kind);
  return renderIcon(CHART_ICON_SIZE, [
    { color: CASING, covers: mark(1.75) },
    { color: OUTLINE, covers: mark(0.85) },
  ], pixelRatio);
}

/** Rasterizes the seamless diagonal hatch used for prohibited anchoring. */
export function renderAnchoringProhibitedPattern(
  pixelRatio: number = ANCHORING_PATTERN_PIXEL_RATIO,
): ReturnType<typeof renderIcon> {
  return renderIcon(ANCHORING_PATTERN_SIZE, [{
    color: HATCH_COLOR,
    opacity: 0.6,
    covers: (x, y) => ((x + y) % HATCH_PERIOD + HATCH_PERIOD) % HATCH_PERIOD < HATCH_WIDTH,
  }], pixelRatio);
}

export function landmarkImageId(shape: LandmarkShapeKey): string {
  return `chart-landmark-${shape}`;
}

/** Rasterizes one landmark outline, with a light casing behind it. */
export function renderLandmarkIcon(
  shape: LandmarkShapeKey,
  pixelRatio: number = ICON_PIXEL_RATIO,
): ReturnType<typeof renderIcon> {
  const mark = landmarkMark(shape);
  return renderIcon(CHART_ICON_SIZE, [
    { color: CASING, covers: mark(1.8) },
    { color: shape === "light-support" ? LIGHT_INK : OUTLINE, covers: mark(0.75) },
  ], pixelRatio);
}

/** Registers every landmark outline, skipping any the style already has. */
export function addLandmarkImages(map: Pick<MapLibreMap, "hasImage" | "addImage">): void {
  for (const shape of LANDMARK_SHAPE_KEYS) {
    const imageId = landmarkImageId(shape);
    if (map.hasImage(imageId)) continue;
    map.addImage(imageId, renderLandmarkIcon(shape), { pixelRatio: ICON_PIXEL_RATIO });
  }
}

/** Registers every buoy icon, skipping any the style already has. */
export function addBuoyImages(map: Pick<MapLibreMap, "hasImage" | "addImage">): void {
  for (const shape of BUOY_SHAPE_KEYS) {
    for (const color of BUOY_COLOR_KEYS) {
      const imageId = buoyImageId(shape, color);
      if (map.hasImage(imageId)) continue;
      map.addImage(imageId, renderBuoyIcon(shape, color), { pixelRatio: ICON_PIXEL_RATIO });
    }
  }
}

/** Registers the wreck, obstruction and rock marks. */
export function addDangerImages(map: Pick<MapLibreMap, "hasImage" | "addImage">): void {
  for (const [kind, imageId] of Object.entries(DANGER_IMAGE_IDS)) {
    if (map.hasImage(imageId)) continue;
    map.addImage(imageId, renderDangerIcon(kind as DangerKind), { pixelRatio: ICON_PIXEL_RATIO });
  }
}

/** Registers the prohibited-anchoring hatch. */
export function addAnchoringPatternImage(map: Pick<MapLibreMap, "hasImage" | "addImage">): void {
  if (map.hasImage(ANCHORING_PROHIBITED_PATTERN_ID)) return;
  map.addImage(ANCHORING_PROHIBITED_PATTERN_ID, renderAnchoringProhibitedPattern(), {
    pixelRatio: ANCHORING_PATTERN_PIXEL_RATIO,
  });
}

/**
 * Picks a buoy icon from `BOYSHP` and the first `COLOUR` code. A buoy with more
 * than one colour, such as red over white, takes the first; the popup lists them all.
 */
export function buoyIconExpression(): ExpressionSpecification {
  const shape: ExpressionSpecification = [
    "match", ["to-string", ["get", "shape"]],
    "1", "cone",
    "2", "can",
    "3", "sphere",
    // Pillar, spar, barrel, super-buoy and ice buoy all read as an upright body.
    "pillar",
  ];
  const color: ExpressionSpecification = [
    "match", firstS57CodeExpression("color"),
    "3", "red",
    "4", "green",
    ["6", "9", "11"], "yellow",
    ["2", "7"], "black",
    "1", "white",
    "other",
  ];
  return ["concat", "chart-buoy-", shape, "-", color];
}

/** Picks a danger mark from the contract's `kind`. */
export function dangerIconExpression(): ExpressionSpecification {
  return [
    "match", ["to-string", ["get", "kind"]],
    "wreck", DANGER_IMAGE_IDS.wreck,
    "rock", DANGER_IMAGE_IDS.rock,
    DANGER_IMAGE_IDS.obstruction,
  ];
}

/**
 * Picks a landmark outline. `FUNCTN` 33 decides first and on its own: a light
 * support is a lighthouse structure whatever `CATLMK` calls it, and NOAA charts
 * light supports as chimneys and domes as well as towers. Category only says
 * what kind of structure an unlit landmark is, and a category with no outline
 * of its own — a cairn, a monument, a flagstaff — takes the plain position mark
 * rather than borrowing the shape of something it is not.
 */
export function landmarkIconExpression(): ExpressionSpecification {
  return [
    "case",
    s57CodeListIncludesExpression("function", FUNCTION_LIGHT_SUPPORT),
    landmarkImageId("light-support"),
    [
      "match", firstS57CodeExpression("category"),
      "17", landmarkImageId("tower"),
      "7", landmarkImageId("mast"),
      "3", landmarkImageId("chimney"),
      "20", landmarkImageId("spire"),
      "15", landmarkImageId("dome"),
      landmarkImageId("mark"),
    ],
  ];
}

/**
 * Each landmark outline as a function of stroke half-width, so the casing and
 * the outline come from one description, exactly as a danger mark does.
 *
 * Every shape stands on the bottom edge of the icon, which `icon-anchor:
 * "bottom"` puts on the charted position, so the structure rises from its own
 * spot the way it does on the ground.
 */
function landmarkMark(shape: LandmarkShapeKey): (halfWidth: number) => (x: number, y: number) => boolean {
  const base = (halfWidth: number) => stroke([4.6, 15], [11.4, 15], halfWidth);
  if (shape === "tower") {
    // A splayed tower under a gallery wider than its body.
    return (halfWidth) => union(
      base(halfWidth),
      stroke([5.4, 15], [6.4, 5.5], halfWidth),
      stroke([10.6, 15], [9.6, 5.5], halfWidth),
      stroke([5.2, 5.5], [10.8, 5.5], halfWidth),
    );
  }
  if (shape === "light-support") {
    // The same tower carrying a lantern: the flare of the co-located light
    // springs from the charted position at the tower's foot.
    return (halfWidth) => union(
      base(halfWidth),
      stroke([5.4, 15], [6.4, 6.5], halfWidth),
      stroke([10.6, 15], [9.6, 6.5], halfWidth),
      stroke([5.2, 6.5], [10.8, 6.5], halfWidth),
      ring(8, 3.8, 2.3, halfWidth),
    );
  }
  if (shape === "mast") {
    // A bare pole on a footing, crossed near the top.
    return (halfWidth) => union(
      base(halfWidth),
      stroke([8, 15], [8, 2], halfWidth),
      stroke([5.8, 5], [10.2, 5], halfWidth),
    );
  }
  if (shape === "chimney") {
    // A narrow stack, barely tapered, capped rather than galleried.
    return (halfWidth) => union(
      base(halfWidth),
      stroke([6.6, 15], [7, 3.5], halfWidth),
      stroke([9.4, 15], [9, 3.5], halfWidth),
      stroke([6.8, 3.5], [9.2, 3.5], halfWidth),
    );
  }
  if (shape === "spire") {
    return (halfWidth) => union(
      base(halfWidth),
      stroke([5.6, 15], [8, 2.2], halfWidth),
      stroke([10.4, 15], [8, 2.2], halfWidth),
    );
  }
  if (shape === "dome") {
    // The upper half of a circle, sitting on its own springing line.
    return (halfWidth) => {
      const outline = ring(8, 12.5, 4.4, halfWidth);
      return union(
        base(halfWidth),
        stroke([3.6, 12.5], [12.4, 12.5], halfWidth),
        (x, y) => y <= 12.5 && outline(x, y),
      );
    };
  }
  // Everything else — a cairn, a monument, a statue — takes the plain circle
  // and centre dot that marks a charted position and claims no shape for it.
  return (halfWidth) => union(
    ring(8, 10.4, 3.7, halfWidth),
    stroke([8, 10.4], [8, 10.4], halfWidth + 0.6),
  );
}

/**
 * Each danger mark as a function of stroke half-width, so the casing and the
 * symbol itself come from one description.
 */
function dangerMark(kind: DangerKind): (halfWidth: number) => (x: number, y: number) => boolean {
  if (kind === "wreck") {
    // A hull line crossed by three masts.
    return (halfWidth) => union(
      stroke([2.5, 9], [13.5, 9], halfWidth),
      stroke([5, 5.5], [5, 12.5], halfWidth),
      stroke([8, 4.5], [8, 13.5], halfWidth),
      stroke([11, 5.5], [11, 12.5], halfWidth),
    );
  }
  if (kind === "rock") {
    return (halfWidth) => union(
      stroke([8, 2.5], [8, 13.5], halfWidth),
      stroke([2.5, 8], [13.5, 8], halfWidth),
    );
  }
  // An obstruction is the rock mark inside a ring.
  return (halfWidth) => union(
    stroke([8, 4], [8, 12], halfWidth),
    stroke([4, 8], [12, 8], halfWidth),
    ring(8, 8, 6.2, halfWidth),
  );
}
