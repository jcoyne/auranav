import { describe, expect, it } from "vitest";
import type { ChartCell } from "../chart-package";
import { selectChartCells } from "./cell-selection";

function cell(name: string, usageBand: number, compilationScale: number, bounds: ChartCell["bounds"]): ChartCell {
  return {
    name,
    edition: 1,
    updateNumber: 0,
    issueDate: "2026-01-01",
    updateApplicationDate: "2026-01-01",
    usageBand,
    compilationScale,
    bounds,
  };
}

const general = cell("US2AAAAA", 2, 1_200_000, [-92, 41, -84, 49]);
const approaches = [
  cell("US4AAAAA", 4, 90_000, [-89, 42, -87, 44]),
  cell("US4BBBBB", 4, 90_000, [-87, 42, -85, 44]),
];
const harbour = cell("US5AAAAA", 5, 20_000, [-88.1, 42.9, -87.8, 43.2]);

describe("selectChartCells", () => {
  it("selects intersecting fallback bands through the appropriate usage band", () => {
    const cells = [general, ...approaches, harbour];
    expect(selectChartCells(cells, [-90, 42, -86, 44], 1_000_000, true).map((item) => item.name))
      .toEqual(["US2AAAAA"]);
    expect(selectChartCells(cells, [-88.5, 42, -86, 44], 100_000, true).map((item) => item.name))
      .toEqual(["US2AAAAA", "US4AAAAA", "US4BBBBB"]);
    expect(selectChartCells(cells, [-88, 42.95, -87.85, 43.1], 25_000, true).map((item) => item.name))
      .toEqual(["US2AAAAA", "US4AAAAA", "US5AAAAA"]);
  });

  it("does not select cells outside the viewport", () => {
    expect(selectChartCells([general, harbour], [-80, 40, -79, 41], 20_000)).toEqual([]);
  });

  it("retains single-band selection for packages without coverage masks", () => {
    expect(selectChartCells([general, ...approaches, harbour], [-88, 42.95, -87.85, 43.1], 25_000)
      .map((item) => item.name)).toEqual(["US5AAAAA"]);
  });
});
