import type { DepthUnit } from "../chart-package";

/** Depths stay in metres in the tiles; the display unit is a presentation concern. */
export function depthConversionFactor(unit: DepthUnit): number {
  return unit === "foot" ? 3.28084 : unit === "fathom" ? 0.546807 : 1;
}

/** A depth in metres, converted and formatted the way a sounding is drawn. */
export function formatDepthInUnit(metres: number, unit: DepthUnit): string {
  return (metres * depthConversionFactor(unit)).toFixed(1);
}

export function depthUnitLabel(unit: DepthUnit): string {
  if (unit === "foot") return "feet";
  if (unit === "fathom") return "fathoms";
  return "metres";
}
