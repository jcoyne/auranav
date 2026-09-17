import { describe, expect, it } from "vitest";
import type { ChartCell } from "../chart-package";
import { displayScaleDenominator, evaluateChartScale } from "./chart-scale";

const overview: ChartCell = {
  name: "US3ABCDE",
  edition: 1,
  updateNumber: 0,
  issueDate: "2026-01-01",
  updateApplicationDate: "2026-01-01",
  usageBand: 3,
  compilationScale: 90_000,
  bounds: [-88, 42, -87, 44],
};

const harbour: ChartCell = {
  ...overview,
  name: "US5ABCDE",
  usageBand: 5,
  compilationScale: 20_000,
  bounds: [-87.9, 42.9, -87.7, 43.1],
};

describe("chart scale", () => {
  it("halves the scale denominator for each zoom level", () => {
    const scale = displayScaleDenominator(10, 43);
    expect(displayScaleDenominator(11, 43)).toBeCloseTo(scale / 2);
  });

  it("uses the most detailed cell covering the map center", () => {
    const state = evaluateChartScale([overview, harbour], 12, -87.8, 43);
    expect(state.kind).toBe("covered");
    if (state.kind !== "covered") return;
    expect(state.cell.name).toBe("US5ABCDE");
    expect(state.overscaleFactor).toBeGreaterThanOrEqual(1);
  });

  it("reports an overscale factor when viewing closer than compilation scale", () => {
    const state = evaluateChartScale([overview], 14, -87.8, 43);
    expect(state.kind).toBe("covered");
    if (state.kind !== "covered") return;
    expect(state.displayScale).toBeLessThan(overview.compilationScale);
    expect(state.overscaleFactor).toBeGreaterThan(1);
  });

  it("reports when the center is outside every cell", () => {
    expect(evaluateChartScale([overview], 10, -90, 43).kind).toBe("outside-coverage");
  });
});
