import { describe, expect, it } from "vitest";
import {
  AREA_FEATURE,
  type ChartInteraction,
  chooseInteraction,
  LINE_FEATURE,
  POINT_FEATURE,
  type QueriedFeature,
} from "./feature-popup";

function interaction(layerId: string, peerPrefix: string, precedence: number): ChartInteraction {
  return { layerId, peerPrefix, precedence, format: (properties) => String(properties.label) };
}

const SOUNDING = interaction("chart-sounding-hit-0", "chart-sounding-hit-", POINT_FEATURE);
const SOUNDING_COARSE = interaction("chart-sounding-hit-1", "chart-sounding-hit-", POINT_FEATURE);
const CABLE = interaction("chart-cable-hit-0", "chart-cable-hit-", LINE_FEATURE);
const AREA = interaction("chart-restricted-area-fill-0", "chart-restricted-area-fill-", AREA_FEATURE);
const REGISTRY = [SOUNDING, SOUNDING_COARSE, CABLE, AREA];

/** MapLibre returns rendered features topmost first. */
function feature(layerId: string, label: string): QueriedFeature {
  return { layer: { id: layerId }, properties: { label } };
}

describe("choosing which feature a tap describes", () => {
  it("describes the sounding, not the restricted area it sits in", () => {
    const chosen = chooseInteraction(
      [feature("chart-restricted-area-fill-0", "area"), feature("chart-sounding-hit-0", "12.5")],
      REGISTRY,
    );
    expect(chosen?.interaction.layerId).toBe("chart-sounding-hit-0");
    expect(chosen?.properties).toEqual([{ label: "12.5" }]);
  });

  it("prefers a point to a line and a line to an area", () => {
    const all = [
      feature("chart-restricted-area-fill-0", "area"),
      feature("chart-cable-hit-0", "cable"),
      feature("chart-sounding-hit-0", "sounding"),
    ];
    expect(chooseInteraction(all, REGISTRY)?.interaction.layerId).toBe("chart-sounding-hit-0");
    expect(chooseInteraction(all.slice(0, 2), REGISTRY)?.interaction.layerId).toBe("chart-cable-hit-0");
    expect(chooseInteraction(all.slice(0, 1), REGISTRY)?.interaction.layerId)
      .toBe("chart-restricted-area-fill-0");
  });

  it("merges the same kind of feature across overlapping cells", () => {
    // A coarse fallback cell stays rendered beneath detailed coverage, so one
    // sounding can answer from two cells. That is one popup, not two.
    const chosen = chooseInteraction(
      [feature("chart-sounding-hit-0", "12.5"), feature("chart-sounding-hit-1", "12.4")],
      REGISTRY,
    );
    expect(chosen?.properties).toEqual([{ label: "12.5" }, { label: "12.4" }]);
  });

  it("keeps the topmost of two equally specific features", () => {
    const buoy = interaction("chart-buoy-hit-0", "chart-buoy-hit-", POINT_FEATURE);
    const chosen = chooseInteraction(
      [feature("chart-buoy-hit-0", "buoy"), feature("chart-sounding-hit-0", "12.5")],
      [...REGISTRY, buoy],
    );
    expect(chosen?.interaction.layerId).toBe("chart-buoy-hit-0");
    expect(chosen?.properties).toEqual([{ label: "buoy" }]);
  });

  it("ignores layers that are not tappable and features with no properties", () => {
    expect(chooseInteraction([feature("chart-coastline-0", "x")], REGISTRY)).toBeUndefined();
    expect(chooseInteraction([{ layer: { id: "chart-sounding-hit-0" }, properties: null }], REGISTRY))
      .toBeUndefined();
    expect(chooseInteraction([], REGISTRY)).toBeUndefined();
  });
});
