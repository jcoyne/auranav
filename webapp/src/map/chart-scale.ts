import type { ChartCell } from "../chart-package";

const EARTH_CIRCUMFERENCE_METRES = 40_075_016.686;
const MAPLIBRE_TILE_SIZE = 512;
const STANDARD_PIXEL_SIZE_METRES = 0.000_28;
const MAX_MERCATOR_LATITUDE = 85.051_129;

export type ChartScaleState =
  | { kind: "outside-coverage"; displayScale: number }
  | {
    kind: "covered";
    cell: ChartCell;
    displayScale: number;
    overscaleFactor: number;
  };

export function evaluateChartScale(
  cells: readonly ChartCell[],
  zoom: number,
  longitude: number,
  latitude: number,
): ChartScaleState {
  const displayScale = displayScaleDenominator(zoom, latitude);
  const coveringCells = cells
    .filter((cell) => contains(cell.bounds, longitude, latitude))
    .sort((left, right) => left.compilationScale - right.compilationScale);
  const cell = coveringCells[0];
  if (!cell) return { kind: "outside-coverage", displayScale };

  return {
    kind: "covered",
    cell,
    displayScale,
    overscaleFactor: Math.max(1, cell.compilationScale / displayScale),
  };
}

export function displayScaleDenominator(zoom: number, latitude: number): number {
  const safeZoom = Number.isFinite(zoom) ? zoom : 0;
  const safeLatitude = Number.isFinite(latitude)
    ? Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude))
    : 0;
  const groundResolution = EARTH_CIRCUMFERENCE_METRES * Math.cos(safeLatitude * Math.PI / 180)
    / (MAPLIBRE_TILE_SIZE * 2 ** safeZoom);
  return groundResolution / STANDARD_PIXEL_SIZE_METRES;
}

function contains(bounds: ChartCell["bounds"], longitude: number, latitude: number): boolean {
  const [west, south, east, north] = bounds;
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
