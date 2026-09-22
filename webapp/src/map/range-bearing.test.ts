import { describe, expect, it } from "vitest";
import {
  COINCIDENT_BEARING_DEGREES,
  formatBearing,
  formatRange,
  type LatLng,
  METRES_PER_NAUTICAL_MILE,
  rangeNauticalMiles,
  trueBearingDegrees,
} from "./range-bearing";

function at(latitude: number, longitude: number): LatLng {
  return { latitude, longitude };
}

describe("range and bearing", () => {
  it("measures a degree of latitude as the expected sixty-odd nautical miles", () => {
    // One degree of latitude is 60 nautical miles by the definition of the mile,
    // and 60.04 on the mean sphere this module uses.
    expect(rangeNauticalMiles(at(0, 0), at(1, 0))).toBeCloseTo(60.0405, 3);
    expect(trueBearingDegrees(at(0, 0), at(1, 0))).toBe(0);
    expect(trueBearingDegrees(at(1, 0), at(0, 0))).toBe(180);
  });

  it("measures a degree of longitude on the equator as due east", () => {
    expect(rangeNauticalMiles(at(0, 0), at(0, 1))).toBeCloseTo(60.0405, 3);
    expect(trueBearingDegrees(at(0, 0), at(0, 1))).toBe(90);
    expect(trueBearingDegrees(at(0, 1), at(0, 0))).toBe(270);
  });

  it("uses exactly 1852 metres per nautical mile", () => {
    expect(METRES_PER_NAUTICAL_MILE).toBe(1852);
    // Half the earth's circumference on the mean sphere, in miles of 1852 m.
    const halfCircumference = Math.PI * 6_371_008.8 / METRES_PER_NAUTICAL_MILE;
    expect(rangeNauticalMiles(at(0, 0), at(0, 180))).toBeCloseTo(halfCircumference, 6);
  });

  it("crosses the antimeridian the short way", () => {
    const west = at(45, 179.9);
    const east = at(45, -179.9);
    // 0.2° of longitude at 45° N, not 359.8° the long way round the world.
    expect(rangeNauticalMiles(west, east)).toBeCloseTo(8.491012, 5);
    expect(trueBearingDegrees(west, east)).toBeCloseTo(89.929289, 5);
    expect(trueBearingDegrees(east, west)).toBeCloseTo(270.070711, 5);
  });

  it("reports zero range and a documented northerly bearing for the same point", () => {
    const here = at(46.81, -90.81);
    expect(rangeNauticalMiles(here, here)).toBe(0);
    expect(trueBearingDegrees(here, here)).toBe(COINCIDENT_BEARING_DEGREES);
    expect(COINCIDENT_BEARING_DEGREES).toBe(0);
  });

  it("measures an Apostle Islands leg against an independently computed value", () => {
    // Devils Island at the north of the group to Long Island at the south,
    // approximately. Checked against the spherical law of cosines and against
    // the reverse bearing, which differ from the haversine/forward results
    // computed here by less than a thousandth of a unit.
    const devilsIsland = at(47.0828, -90.7289);
    const longIsland = at(46.7, -90.75);

    expect(rangeNauticalMiles(devilsIsland, longIsland)).toBeCloseTo(22.999818, 5);
    expect(trueBearingDegrees(devilsIsland, longIsland)).toBeCloseTo(182.164915, 5);
    expect(trueBearingDegrees(longIsland, devilsIsland)).toBeCloseTo(2.149511, 5);
  });

  it("normalises a bearing into [0, 360)", () => {
    // A westerly leg is the case that would otherwise come back negative.
    const bearing = trueBearingDegrees(at(10, 20), at(10, 19));
    expect(bearing).toBeGreaterThan(269);
    expect(bearing).toBeLessThan(360);
  });

  it("keeps a malformed fix off the display instead of showing NaN", () => {
    const broken = at(Number.NaN, -90.8);
    expect(rangeNauticalMiles(broken, at(46.8, -90.8))).toBe(0);
    expect(trueBearingDegrees(broken, at(46.8, -90.8))).toBe(COINCIDENT_BEARING_DEGREES);
  });

  it("drops precision as the range grows", () => {
    expect(formatRange(0)).toBe("0.00 NM");
    expect(formatRange(1.2345)).toBe("1.23 NM");
    expect(formatRange(9.999)).toBe("10.0 NM");
    expect(formatRange(42.57)).toBe("42.6 NM");
    expect(formatRange(123.4)).toBe("123 NM");
    expect(formatRange(Number.NaN)).toBe("— NM");
  });

  it("writes a bearing as three digits labelled true", () => {
    expect(formatBearing(0)).toBe("000° T");
    expect(formatBearing(9.4)).toBe("009° T");
    expect(formatBearing(182.164915)).toBe("182° T");
    expect(formatBearing(359.6)).toBe("000° T");
    expect(formatBearing(Number.NaN)).toBe("—° T");
  });
});
