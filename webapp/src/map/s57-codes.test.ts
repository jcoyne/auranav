import { describe, expect, it } from "vitest";
import {
  describeS57Code,
  describeS57CodeList,
  parseS57CodeList,
  s57AttributeLabel,
  s57Meaning,
} from "./s57-codes";

describe("S-57 code meanings", () => {
  it("reads a documented code from the published table", () => {
    expect(describeS57Code("RESTRN", "1")).toBe("anchoring prohibited");
    expect(describeS57Code("CATHAF", "5")).toBe("yacht harbour/marina");
    expect(describeS57Code("BOYSHP", "2")).toBe("can (cylindrical)");
    expect(describeS57Code("COLOUR", "3")).toBe("red");
    expect(describeS57Code("WATLEV", "3")).toBe("always under water/submerged");
  });

  it("shows the bare code where the table has no entry", () => {
    // The GDAL table stops at RESTRN 15; NOAA cells use 16, 17, 22 and 24.
    // A chart viewer must not invent wording for a restriction it cannot name.
    expect(describeS57Code("RESTRN", "24")).toBe("restriction 24");
    expect(describeS57Code("RESTRN", "16")).toBe("restriction 16");
    expect(describeS57Code("RESTRN", "17")).toBe("restriction 17");
    expect(describeS57Code("RESTRN", "22")).toBe("restriction 22");
    expect(s57Meaning("RESTRN", "24")).toBeUndefined();
  });

  it("names an unknown code after its attribute", () => {
    // CATREA has gaps of its own, at 2, 3 and 11 among others.
    expect(describeS57Code("CATREA", "11")).toBe("restricted area category 11");
    expect(describeS57Code("CATSPM", "38")).toBe("special purpose mark 38");
    expect(s57AttributeLabel("RESTRN")).toBe("restriction");
  });

  it("keeps the documented meanings of the codes around a gap", () => {
    expect(describeS57Code("RESTRN", "15")).toBe("construction prohibited");
    expect(describeS57Code("CATREA", "10")).toBe("historic wreck area");
    expect(describeS57Code("CATREA", "12")).toBe("navigational aid safety zone");
  });

  it("describes a list, keeping any unknown code as a code", () => {
    expect(describeS57CodeList("RESTRN", "2,6,24"))
      .toBe("anchoring restricted, trawling restricted, restriction 24");
    expect(describeS57CodeList("COLOUR", "3,1")).toBe("red, white");
  });

  it("treats an absent or empty property as no value at all", () => {
    expect(describeS57CodeList("RESTRN", undefined)).toBeUndefined();
    expect(describeS57CodeList("RESTRN", null)).toBeUndefined();
    expect(describeS57CodeList("RESTRN", "")).toBeUndefined();
    expect(describeS57CodeList("RESTRN", " , ")).toBeUndefined();
  });

  it("parses the comma-separated form the pipeline writes", () => {
    expect(parseS57CodeList("3,1")).toEqual(["3", "1"]);
    expect(parseS57CodeList(" 3 , 1 ")).toEqual(["3", "1"]);
    // A single-valued attribute passes through unchanged, as a string or a number.
    expect(parseS57CodeList("6")).toEqual(["6"]);
    expect(parseS57CodeList(6)).toEqual(["6"]);
    expect(parseS57CodeList(undefined)).toEqual([]);
  });
});
