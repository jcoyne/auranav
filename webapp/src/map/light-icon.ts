import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

/** Raw RGBA image data in the shape `Map.addImage` accepts. */
export type LightFlareImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type LightFlareColor = "red" | "green" | "yellow";

export const LIGHT_FLARE_IMAGE_IDS: Record<LightFlareColor, string> = {
  red: "light-flare-red",
  green: "light-flare-green",
  yellow: "light-flare-yellow",
};

const FLARE_COLORS: Record<LightFlareColor, readonly [number, number, number]> = {
  red: [237, 28, 36],
  green: [0, 173, 122],
  yellow: [255, 218, 0],
};

// The flare is the convex hull of the round bulb and the sharp tip that marks the
// charted light position. Lengths are style pixels, taken from the source artwork.
const BULB_RADIUS = 7.5;
const TIP_TO_BULB = 25.2;
// Charts draw the flare away from the light, up and to the right.
const BULB_DIRECTION = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
// Large enough for the bulb's far edge: TIP_TO_BULB * cos(45°) + BULB_RADIUS.
const IMAGE_SIZE = 26;
// The tip sits in the bottom-left corner, so `icon-anchor: bottom-left` puts it on the light.
const TIP = { x: 0, y: IMAGE_SIZE };
const BULB = {
  x: TIP.x + BULB_DIRECTION.x * TIP_TO_BULB,
  y: TIP.y + BULB_DIRECTION.y * TIP_TO_BULB,
};

export const LIGHT_FLARE_PIXEL_RATIO = 4;
const SUBSAMPLES = 3;

/**
 * Rasterizes one flare. The shape is every disc swept between the tip and the bulb,
 * which is the hull of the two; edge pixels are supersampled for a smooth outline.
 */
export function renderLightFlare(
  color: readonly [number, number, number],
  pixelRatio: number = LIGHT_FLARE_PIXEL_RATIO,
): LightFlareImage {
  const size = IMAGE_SIZE * pixelRatio;
  const data = new Uint8Array(size * size * 4);
  const [red, green, blue] = color;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const alpha = coverage(column / pixelRatio, row / pixelRatio, 1 / pixelRatio);
      if (alpha === 0) continue;
      const offset = (row * size + column) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, data };
}

/** Registers the red, green, and yellow flares, skipping any the style already has. */
export function addLightFlareImages(map: Pick<MapLibreMap, "hasImage" | "addImage">): void {
  for (const [name, imageId] of Object.entries(LIGHT_FLARE_IMAGE_IDS)) {
    if (map.hasImage(imageId)) continue;
    map.addImage(imageId, renderLightFlare(FLARE_COLORS[name as LightFlareColor]), {
      pixelRatio: LIGHT_FLARE_PIXEL_RATIO,
    });
  }
}

/**
 * Picks the flare colour from the S-57 `COLOUR` value. Red and green lights keep their
 * colour; white, yellow, and anything else a cell reports fall back to the yellow flare.
 */
export function lightFlareIconExpression(): ExpressionSpecification {
  return [
    "match", ["downcase", ["to-string", ["get", "color"]]],
    ["3", "red", "[ \"3\" ]", "[\"3\"]"], LIGHT_FLARE_IMAGE_IDS.red,
    ["4", "green", "[ \"4\" ]", "[\"4\"]"], LIGHT_FLARE_IMAGE_IDS.green,
    LIGHT_FLARE_IMAGE_IDS.yellow,
  ];
}

function coverage(x: number, y: number, step: number): number {
  let covered = 0;
  for (let row = 0; row < SUBSAMPLES; row += 1) {
    for (let column = 0; column < SUBSAMPLES; column += 1) {
      const sampleX = x + (step * (column + 0.5)) / SUBSAMPLES;
      const sampleY = y + (step * (row + 0.5)) / SUBSAMPLES;
      if (isInsideFlare(sampleX, sampleY)) covered += 1;
    }
  }
  return covered / (SUBSAMPLES * SUBSAMPLES);
}

/**
 * The hull is the union of discs centred on the tip-to-bulb line whose radius grows from
 * zero at the tip to `BULB_RADIUS`. A point is inside when the closest such disc covers it.
 */
function isInsideFlare(x: number, y: number): boolean {
  const toPointX = x - TIP.x;
  const toPointY = y - TIP.y;
  const toBulbX = BULB.x - TIP.x;
  const toBulbY = BULB.y - TIP.y;
  const spread = toBulbX * toBulbX + toBulbY * toBulbY - BULB_RADIUS * BULB_RADIUS;
  const projection = toPointX * toBulbX + toPointY * toBulbY;
  const along = Math.min(Math.max(projection / spread, 0), 1);
  const distanceToDisc = toPointX * toPointX + toPointY * toPointY
    - 2 * along * projection
    + along * along * spread;
  return distanceToDisc <= 0;
}
