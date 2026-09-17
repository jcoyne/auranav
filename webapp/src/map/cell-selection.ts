import type { Bounds, ChartCell } from "../chart-package";

export function selectChartCells(
  cells: readonly ChartCell[],
  viewport: Bounds,
  displayScale: number,
): ChartCell[] {
  const candidates = cells.filter((cell) => intersects(cell.bounds, viewport));
  if (candidates.length === 0) return [];

  const byUsageBand = new Map<number, ChartCell[]>();
  candidates.forEach((cell) => {
    const bandCells = byUsageBand.get(cell.usageBand) ?? [];
    bandCells.push(cell);
    byUsageBand.set(cell.usageBand, bandCells);
  });
  const selectedBand = [...byUsageBand.entries()]
    .map(([usageBand, bandCells]) => ({
      usageBand,
      score: scaleScore(bandCells, displayScale),
    }))
    .sort((left, right) => left.score - right.score || right.usageBand - left.usageBand)[0]?.usageBand;

  return candidates
    .filter((cell) => cell.usageBand === selectedBand)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function scaleScore(cells: readonly ChartCell[], displayScale: number): number {
  const scales = cells.map((cell) => cell.compilationScale).sort((left, right) => left - right);
  const representativeScale = scales[Math.floor(scales.length / 2)] ?? displayScale;
  return Math.abs(Math.log(representativeScale / Math.max(displayScale, 1)));
}

function intersects(left: Bounds, right: Bounds): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}
