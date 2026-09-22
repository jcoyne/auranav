import { describe, expect, it } from "vitest";
import { formatFeatureDetailsList } from "./chart-features";
import { formatLightDetails, formatLightLabel } from "./light";

describe("navigation light formatting", () => {
  it("uses conventional chart abbreviations in display order", () => {
    expect(formatLightLabel({
      characteristic: "Fl",
      signalGroup: "2",
      color: "red",
      periodSeconds: 4,
      heightMetres: 10,
      nominalRangeNm: 5,
    })).toBe("Fl(2) R 4s 10m 5M");
  });

  it("handles combined colors and missing attributes", () => {
    expect(formatLightLabel({ characteristic: "Oc", color: "white, red", periodSeconds: 2.5 }))
      .toBe("Oc W R 2.5s");
    expect(formatLightLabel({})).toBe("Lt");
  });

  it("decodes the raw S-57 values emitted by NOAA packages", () => {
    const properties = {
      characteristic: 2,
      signalGroup: "(1)",
      color: "[ \"3\" ]",
      periodSeconds: 4,
      heightMetres: 10,
      nominalRangeNm: 5,
    };
    expect(formatLightLabel(properties)).toBe("Fl R 4s 10m 5M");
    expect(formatLightDetails(properties)).toContain("Characteristic: Flashing");
    expect(formatLightDetails(properties)).toContain("Color: Red");
  });

  it("provides expanded accessible details", () => {
    expect(formatLightDetails({
      characteristic: "Q",
      color: "G",
      nominalRangeNm: 7,
      sectorStart: 45,
      sectorEnd: 135,
      orientation: 360,
      heightDatum: "MHW",
    })).toBe([
      "Q G 7M",
      "Characteristic: Quick flashing",
      "Color: Green",
      "Nominal range: 7 nautical miles",
      "Sector: 045°–135°",
      "Orientation: 000°",
      "Height datum: MHW",
    ].join("\n"));
  });

  it("omits invalid numeric values", () => {
    expect(formatLightLabel({ characteristic: "F", periodSeconds: 0, heightMetres: Number.NaN }))
      .toBe("F");
  });

  it("does not silently discard a numeric vertical-datum code", () => {
    expect(formatLightDetails({ characteristic: 19, heightDatum: 12 }))
      .toContain("Characteristic: Flashing alternating\nHeight datum: S-57 code 12");
  });

  it("separates coincident sector-light records in popup text", () => {
    expect(formatFeatureDetailsList([
      { characteristic: 2, color: "[ \"3\" ]", sectorStart: 45, sectorEnd: 135 },
      { characteristic: 2, color: "[ \"4\" ]", sectorStart: 135, sectorEnd: 225 },
    ], formatLightDetails)).toBe([
      "Fl R\nCharacteristic: Flashing\nColor: Red\nSector: 045°–135°",
      "Fl G\nCharacteristic: Flashing\nColor: Green\nSector: 135°–225°",
    ].join("\n\n"));
  });

  it("preserves decimal sector bearings", () => {
    expect(formatLightDetails({ characteristic: 2, sectorStart: 79.5, sectorEnd: 189.5 }))
      .toContain("Sector: 079.5°–189.5°");
  });
});
