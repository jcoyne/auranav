/**
 * Range and bearing between two positions on a sphere.
 *
 * Bearings produced here are TRUE, referenced to the geographic pole, because
 * the chart display is true-north referenced. The ENC data carries magnetic
 * variation (`MAGVAR`), but the preprocessing pipeline does not extract it, so
 * no magnetic bearing is offered rather than an invented one. Callers that show
 * a bearing must label it as true.
 *
 * A sphere is not the shape of the earth. Over the tens of nautical miles this
 * readout is used for, the error against an ellipsoidal solution is a fraction
 * of a percent, which is well inside what a recreational viewer claims.
 */

export type LatLng = {
  readonly latitude: number;
  readonly longitude: number;
};

/** Exact by definition. */
export const METRES_PER_NAUTICAL_MILE = 1852;

/** IUGG mean earth radius, the same figure the track odometer uses. */
const EARTH_RADIUS_METRES = 6_371_008.8;

/** Bearing reported when the two positions coincide and no direction exists. */
export const COINCIDENT_BEARING_DEGREES = 0;

/**
 * Great-circle (haversine) distance in nautical miles. Returns 0 for
 * coincident positions and for any non-finite coordinate, so a malformed fix
 * cannot put `NaN` on screen.
 */
export function rangeNauticalMiles(from: LatLng, to: LatLng): number {
  if (!isUsable(from) || !isUsable(to)) return 0;

  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(normaliseLongitudeDelta(to.longitude - from.longitude));

  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  const metres = 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(haversine)));
  return metres / METRES_PER_NAUTICAL_MILE;
}

/**
 * Initial great-circle bearing in degrees true, normalised to [0, 360).
 *
 * This is the direction to steer *now*: along a great circle the bearing
 * changes as you travel, so it is not the bearing you will hold on arrival.
 */
export function trueBearingDegrees(from: LatLng, to: LatLng): number {
  if (!isUsable(from) || !isUsable(to)) return COINCIDENT_BEARING_DEGREES;

  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const deltaLongitude = toRadians(normaliseLongitudeDelta(to.longitude - from.longitude));
  if (deltaLongitude === 0 && fromLatitude === toLatitude) return COINCIDENT_BEARING_DEGREES;

  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude);
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude)
    - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude);
  return normaliseDegrees(toDegrees(Math.atan2(y, x)));
}

/**
 * Range for display. Precision falls away with distance because the extra
 * digits at 40 miles are noise: two decimals under 10 NM (about 20 m), one
 * under 100 NM, none beyond.
 */
export function formatRange(nauticalMiles: number): string {
  if (!Number.isFinite(nauticalMiles)) return "— NM";
  const value = Math.max(0, nauticalMiles);
  // The band is chosen from what the number will read as, so 9.999 shows as
  // `10.0 NM` rather than gaining a digit it loses again a metre later.
  const digits = value < 9.995 ? 2 : value < 99.95 ? 1 : 0;
  return `${value.toFixed(digits)} NM`;
}

/**
 * Bearing for display, as three digits with the customary leading zeros, so
 * `009° T` cannot be misread. 359.6° rounds to 360, which is written `000° T`.
 */
export function formatBearing(degrees: number): string {
  if (!Number.isFinite(degrees)) return "—° T";
  const rounded = Math.round(normaliseDegrees(degrees)) % 360;
  return `${String(rounded).padStart(3, "0")}° T`;
}

/** A position in the decimal-degree form the rest of the app displays. */
export function formatLatLng(point: LatLng): string {
  return `${formatCoordinate(point.latitude, "N", "S")}, ${formatCoordinate(point.longitude, "E", "W")}`;
}

function formatCoordinate(value: number, positive: string, negative: string): string {
  if (!Number.isFinite(value)) return `—° ${positive}`;
  const direction = value < 0 ? negative : positive;
  return `${Math.abs(value).toFixed(5)}° ${direction}`;
}

function isUsable(point: LatLng): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

/**
 * Keeps a pair straddling the antimeridian on the short way round: -179.9° is
 * 0.2° east of 179.9°, not 359.8° west of it.
 */
function normaliseLongitudeDelta(degrees: number): number {
  return ((degrees % 360) + 540) % 360 - 180;
}

function normaliseDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}
