import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  LIGHT_FLARE_IMAGE_IDS,
  LIGHT_FLARE_PIXEL_RATIO,
  addLightFlareImages,
  lightFlareIconExpression,
  renderLightFlare,
} from "./light-icon";

const RED = [237, 28, 36] as const;

describe("light flare image", () => {
  it("draws a square icon at the requested pixel ratio", () => {
    const image = renderLightFlare(RED, 2);

    expect(image.width).toBe(image.height);
    expect(image.data.length).toBe(image.width * image.height * 4);
    expect(renderLightFlare(RED, 4).width).toBe(image.width * 2);
  });

  it("puts the sharp tip in the bottom-left corner and the bulb up and to the right", () => {
    const image = renderLightFlare(RED, 2);
    const size = image.width;
    const alpha = (x: number, y: number) => image.data[(y * size + x) * 4 + 3] ?? 0;

    // The tip touches the corner that `icon-anchor: bottom-left` pins to the light.
    expect(alpha(0, size - 1)).toBeGreaterThan(0);
    // The bulb fills the middle of the upper-right diagonal.
    expect(alpha(Math.round(size * 0.7), Math.round(size * 0.3))).toBe(255);
    // The three corners the flare does not reach stay transparent.
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(size - 1, 0)).toBe(0);
    expect(alpha(size - 1, size - 1)).toBe(0);
  });

  it("paints every opaque pixel in the requested colour", () => {
    const image = renderLightFlare(RED, 2);

    for (let offset = 0; offset < image.data.length; offset += 4) {
      if (image.data[offset + 3] === 0) continue;
      expect([image.data[offset], image.data[offset + 1], image.data[offset + 2]]).toEqual([...RED]);
    }
  });

  it("softens the outline instead of leaving a hard edge", () => {
    const image = renderLightFlare(RED, 2);
    const partial = [...image.data.filter((_, index) => index % 4 === 3)]
      .filter((value) => value > 0 && value < 255);

    expect(partial.length).toBeGreaterThan(0);
  });
});

describe("registering flare images", () => {
  it("adds one image per light colour", () => {
    const map = { hasImage: vi.fn(() => false), addImage: vi.fn() } as unknown as MapLibreMap;

    addLightFlareImages(map);

    expect(map.addImage).toHaveBeenCalledTimes(3);
    for (const imageId of Object.values(LIGHT_FLARE_IMAGE_IDS)) {
      expect(map.addImage).toHaveBeenCalledWith(
        imageId,
        expect.objectContaining({ data: expect.any(Uint8Array) }),
        { pixelRatio: LIGHT_FLARE_PIXEL_RATIO },
      );
    }
  });

  it("leaves images the style already has in place", () => {
    const map = { hasImage: vi.fn(() => true), addImage: vi.fn() } as unknown as MapLibreMap;

    addLightFlareImages(map);

    expect(map.addImage).not.toHaveBeenCalled();
  });
});

describe("flare colour selection", () => {
  const select = (color: string): string => {
    const expression = lightFlareIconExpression();
    const cases = expression.slice(2, -1);
    for (let index = 0; index < cases.length; index += 2) {
      const labels = cases[index] as string[];
      if (labels.includes(color.toLowerCase())) return cases[index + 1] as string;
    }
    return expression[expression.length - 1] as string;
  };

  it("keeps red and green lights in their own colour", () => {
    expect(select("3")).toBe(LIGHT_FLARE_IMAGE_IDS.red);
    expect(select("red")).toBe(LIGHT_FLARE_IMAGE_IDS.red);
    expect(select("[\"4\"]")).toBe(LIGHT_FLARE_IMAGE_IDS.green);
    expect(select("green")).toBe(LIGHT_FLARE_IMAGE_IDS.green);
  });

  it("shows white, yellow, and unrecognized colours as yellow", () => {
    expect(select("1")).toBe(LIGHT_FLARE_IMAGE_IDS.yellow);
    expect(select("white")).toBe(LIGHT_FLARE_IMAGE_IDS.yellow);
    expect(select("6")).toBe(LIGHT_FLARE_IMAGE_IDS.yellow);
    expect(select("yellow")).toBe(LIGHT_FLARE_IMAGE_IDS.yellow);
    expect(select("violet")).toBe(LIGHT_FLARE_IMAGE_IDS.yellow);
    expect(select("[ \"1\", \"3\" ]")).toBe(LIGHT_FLARE_IMAGE_IDS.yellow);
  });
});
