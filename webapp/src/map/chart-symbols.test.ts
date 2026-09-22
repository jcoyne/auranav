import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import {
  addAnchoringPatternImage,
  addBuoyImages,
  addDangerImages,
  ANCHORING_PATTERN_SIZE,
  ANCHORING_PROHIBITED_PATTERN_ID,
  buoyIconExpression,
  CHART_ICON_SIZE,
  dangerIconExpression,
  DANGER_IMAGE_IDS,
  renderAnchoringProhibitedPattern,
  renderBuoyIcon,
  renderDangerIcon,
} from "./chart-symbols";
import { ICON_PIXEL_RATIO } from "./raster-icon";

const IMAGE_PROPERTY_SPEC = {
  type: "string",
  "property-type": "data-driven",
  expression: { interpolated: false, parameters: ["zoom", "feature"] },
} as const;

/** Evaluates a style expression the way MapLibre would for one tile feature. */
function iconFor(expression: ExpressionSpecification, properties: Record<string, unknown>): string {
  const compiled = createExpression(expression, IMAGE_PROPERTY_SPEC as never);
  if (compiled.result !== "success") throw new Error(compiled.value.map(String).join("\n"));
  return compiled.value.evaluate({ zoom: 14 }, { properties } as never) as string;
}

function imageIdsAddedBy(add: (map: Pick<MapLibreMap, "hasImage" | "addImage">) => void): string[] {
  const addImage = vi.fn();
  add({ hasImage: () => false, addImage } as unknown as MapLibreMap);
  return addImage.mock.calls.map(([imageId]) => imageId as string);
}

function alphaAt(image: { width: number; data: Uint8Array }, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

function colorAt(image: { width: number; data: Uint8Array }, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 3)];
}

describe("buoy symbols", () => {
  it("picks the shape from BOYSHP and the colour from the first COLOUR code", () => {
    const expression = buoyIconExpression();
    // A red can with a white band is a red can: the popup lists both colours.
    expect(iconFor(expression, { shape: "2", color: "3,1" })).toBe("chart-buoy-can-red");
    expect(iconFor(expression, { shape: "1", color: "4" })).toBe("chart-buoy-cone-green");
    expect(iconFor(expression, { shape: "3", color: "6" })).toBe("chart-buoy-sphere-yellow");
    expect(iconFor(expression, { shape: "5", color: "2" })).toBe("chart-buoy-pillar-black");
  });

  it("draws a buoy whose colour or shape it cannot symbolize without guessing at one", () => {
    const expression = buoyIconExpression();
    // Pink has no symbol colour here, and an absent colour has none at all.
    expect(iconFor(expression, { shape: "4", color: "13" })).toBe("chart-buoy-pillar-other");
    expect(iconFor(expression, {})).toBe("chart-buoy-pillar-other");
  });

  it("registers every icon its expression can name", () => {
    const registered = new Set(imageIdsAddedBy(addBuoyImages));
    const expression = buoyIconExpression();
    for (const shape of ["1", "2", "3", "4", "5", "6", "7", "8", ""]) {
      for (const color of ["1", "2", "3", "4", "6", "7", "9", "11", "13", ""]) {
        expect(registered).toContain(iconFor(expression, { shape, color }));
      }
    }
  });

  it("skips an icon the style already holds", () => {
    const addImage = vi.fn();
    addBuoyImages({ hasImage: () => true, addImage } as unknown as MapLibreMap);
    expect(addImage).not.toHaveBeenCalled();
  });

  it("rasterizes a buoy as its colour inside a dark outline", () => {
    const image = renderBuoyIcon("can", "red");
    expect(image.width).toBe(CHART_ICON_SIZE * ICON_PIXEL_RATIO);
    expect(image.height).toBe(image.width);
    const centre = Math.round(8 * ICON_PIXEL_RATIO);
    expect(colorAt(image, centre, centre)).toEqual([203, 42, 47]);
    expect(alphaAt(image, centre, centre)).toBe(255);
    // The can does not fill the icon box, so its corners stay clear.
    expect(alphaAt(image, 0, 0)).toBe(0);
  });
});

describe("danger symbols", () => {
  it("marks each danger kind, and an unexpected kind as an obstruction", () => {
    const expression = dangerIconExpression();
    expect(iconFor(expression, { kind: "wreck" })).toBe(DANGER_IMAGE_IDS.wreck);
    expect(iconFor(expression, { kind: "rock" })).toBe(DANGER_IMAGE_IDS.rock);
    expect(iconFor(expression, { kind: "obstruction" })).toBe(DANGER_IMAGE_IDS.obstruction);
    expect(iconFor(expression, {})).toBe(DANGER_IMAGE_IDS.obstruction);
  });

  it("registers one image per mark", () => {
    expect(imageIdsAddedBy(addDangerImages).sort()).toEqual(Object.values(DANGER_IMAGE_IDS).sort());
  });

  it("draws each mark through the centre of its icon", () => {
    const centre = Math.round(8 * ICON_PIXEL_RATIO);
    for (const kind of ["wreck", "obstruction", "rock"] as const) {
      expect(alphaAt(renderDangerIcon(kind), centre, centre)).toBe(255);
    }
    // Only the obstruction carries a ring, which the cross alone never reaches
    // diagonally out from the centre.
    const diagonalX = Math.round((8 + 6.2 / Math.SQRT2) * ICON_PIXEL_RATIO);
    const diagonalY = Math.round((8 - 6.2 / Math.SQRT2) * ICON_PIXEL_RATIO);
    expect(alphaAt(renderDangerIcon("obstruction"), diagonalX, diagonalY)).toBeGreaterThan(0);
    expect(alphaAt(renderDangerIcon("rock"), diagonalX, diagonalY)).toBe(0);
    expect(alphaAt(renderDangerIcon("wreck"), diagonalX, diagonalY)).toBe(0);
  });
});

describe("prohibited anchoring hatch", () => {
  it("repeats without a seam when tiled", () => {
    const image = renderAnchoringProhibitedPattern();
    const period = (image.width / ANCHORING_PATTERN_SIZE) * 8;
    for (let y = 0; y < image.width; y += 3) {
      for (let x = 0; x + period < image.width; x += 3) {
        expect(alphaAt(image, x, y)).toBe(alphaAt(image, x + period, y));
      }
    }
  });

  it("is a partly transparent red stripe, not a solid fill", () => {
    const image = renderAnchoringProhibitedPattern();
    const alphas = new Set<number>();
    for (let index = 3; index < image.data.length; index += 4) alphas.add(image.data[index] ?? 0);
    expect(alphas).toContain(0);
    expect([...alphas].some((alpha) => alpha > 0 && alpha < 255)).toBe(true);
  });

  it("registers the pattern once", () => {
    expect(imageIdsAddedBy(addAnchoringPatternImage)).toEqual([ANCHORING_PROHIBITED_PATTERN_ID]);
    const addImage = vi.fn();
    addAnchoringPatternImage({ hasImage: () => true, addImage } as unknown as MapLibreMap);
    expect(addImage).not.toHaveBeenCalled();
  });
});
