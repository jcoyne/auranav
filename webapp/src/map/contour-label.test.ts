import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import type { DepthUnit } from "../chart-package";
import { contourLabelExpression } from "./chart-layers";

/** Renders a contour depth the way MapLibre will render it on the map. */
function label(unit: DepthUnit, depthMetres: number): string {
  const compiled = createExpression(contourLabelExpression(unit), "layers[0].layout.text-field");
  if (compiled.result !== "success") throw new Error(JSON.stringify(compiled.value));
  return String(compiled.value.evaluate({ zoom: 12 }, { type: 1, properties: { depth: depthMetres } }));
}

describe("depth contour labels", () => {
  it("names the charted foot curve that NOAA stores in metres", () => {
    // NOAA encodes the 6, 12, 18, 24 and 30 foot curves as these metre values.
    expect([1.8, 3.6, 5.4, 7.3, 9.1].map((depth) => label("foot", depth)))
      .toEqual(["6", "12", "18", "24", "30"]);
  });

  it("names the charted fathom curve", () => {
    expect([1.8, 3.6, 5.4, 7.3, 9.1].map((depth) => label("fathom", depth)))
      .toEqual(["1", "2", "3", "4", "5"]);
  });

  it("keeps a decimal for a metric curve, whose value is the charted one", () => {
    expect([1.8, 3.6, 10].map((depth) => label("metre", depth))).toEqual(["1.8", "3.6", "10.0"]);
  });

  it("rounds a curve that is not a converted whole unit", () => {
    expect(label("foot", 10)).toBe("33");
    expect(label("foot", 18.3)).toBe("60");
  });
});
