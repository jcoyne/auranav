import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
  landLabelFilter,
  landLabelPixelWidth,
  MAXIMUM_LABEL_PIXELS,
  MINIMUM_LABEL_PIXELS,
  MINIMUM_LABEL_SPAN_DEGREES,
} from "./land";

type CompiledFilter = ReturnType<typeof featureFilter>["filter"];

// The band never inspects geometry, so any tile identity will do.
const anyTile = { z: 0, x: 0, y: 0 } as unknown as Parameters<CompiledFilter>[2];

/** Zoom levels at which MapLibre itself accepts the label for a given span. */
function labelledZooms(spanDegrees: number | undefined): number[] {
  const compiled = featureFilter(landLabelFilter(), "layers[0].filter");
  const properties = spanDegrees === undefined ? {} : { spanDegrees };
  return [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    .filter((zoom) => compiled.filter({ zoom }, { type: 1, properties }, anyTile));
}

describe("landform label band", () => {
  it("labels an island only while it reads at screen size", () => {
    // Madeline Island, the largest of the Apostles, spans about 0.13 degrees.
    expect(labelledZooms(0.13)).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it("drops the mainland label once the landform dwarfs the viewport", () => {
    const mainland = labelledZooms(0.9);
    expect(mainland[0]).toBe(6);
    expect(mainland.at(-1)).toBe(11);
  });

  it("labels a small island only at the zooms that show it", () => {
    // Devils Island spans about 0.018 degrees.
    expect(labelledZooms(0.018)).toEqual([12, 13, 14, 15, 16, 17]);
  });

  it("gives a landform without a span the band of a small island", () => {
    expect(labelledZooms(undefined)).toEqual(labelledZooms(MINIMUM_LABEL_SPAN_DEGREES));
    expect(labelledZooms(undefined)).not.toEqual([]);
  });

  it("enters and leaves the band at the documented pixel widths", () => {
    const zooms = labelledZooms(0.13);
    const first = zooms[0] ?? 0;
    const last = zooms.at(-1) ?? 0;
    expect(landLabelPixelWidth(0.13, first)).toBeGreaterThanOrEqual(MINIMUM_LABEL_PIXELS);
    expect(landLabelPixelWidth(0.13, first - 1)).toBeLessThan(MINIMUM_LABEL_PIXELS);
    expect(landLabelPixelWidth(0.13, last)).toBeLessThan(MAXIMUM_LABEL_PIXELS);
    expect(landLabelPixelWidth(0.13, last + 1)).toBeGreaterThanOrEqual(MAXIMUM_LABEL_PIXELS);
  });
});
