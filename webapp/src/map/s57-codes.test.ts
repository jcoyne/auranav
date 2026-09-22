import { describe, expect, it } from "vitest";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import {
  CONDITION_RUINED,
  describeS57Code,
  describeS57CodeList,
  parseS57CodeList,
  s57AttributeLabel,
  s57CodeListIncludes,
  s57CodeListIncludesExpression,
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

  it("reads the shoreline, mooring and condition tables GDAL publishes", () => {
    expect(describeS57Code("CATSLC", "1")).toBe("breakwater");
    expect(describeS57Code("CATSLC", "4")).toBe("pier ( jetty)");
    expect(describeS57Code("CATSLC", "8")).toBe("rip rap");
    expect(describeS57Code("CATSLC", "10")).toBe("sea wall");
    expect(describeS57Code("CATSLC", "16")).toBe("open face wharf");
    expect(describeS57Code("CATMOR", "1")).toBe("dolphin");
    expect(describeS57Code("CATMOR", "3")).toBe("bollard");
    expect(describeS57Code("CATMOR", "7")).toBe("mooring buoy");
    expect(describeS57Code("CONDTN", CONDITION_RUINED)).toBe("ruined");
    expect(describeS57Code("CONDTN", "1")).toBe("under construction");
  });

  it("shows a bare code for a shoreline, mooring or condition code with no entry", () => {
    // `CATSLC` stops at 16, `CATMOR` at 7 and `CONDTN` at 5. A dock whose
    // category is outside the table must not be named after a nearby one.
    expect(describeS57Code("CATSLC", "17")).toBe("shoreline construction 17");
    expect(describeS57Code("CATMOR", "9")).toBe("mooring facility 9");
    expect(describeS57Code("CONDTN", "7")).toBe("condition 7");
    expect(s57Meaning("CATSLC", "17")).toBeUndefined();
    expect(s57Meaning("CATMOR", "9")).toBeUndefined();
    expect(s57Meaning("CONDTN", "7")).toBeUndefined();
    expect(s57AttributeLabel("CATSLC")).toBe("shoreline construction");
    expect(s57AttributeLabel("CONDTN")).toBe("condition");
  });

  it("finds one code in a list, in TypeScript and in a style expression alike", () => {
    expect(s57CodeListIncludes("2", CONDITION_RUINED)).toBe(true);
    expect(s57CodeListIncludes("1,2", CONDITION_RUINED)).toBe(true);
    expect(s57CodeListIncludes("1", CONDITION_RUINED)).toBe(false);
    expect(s57CodeListIncludes(undefined, CONDITION_RUINED)).toBe(false);

    const ruined = (condition?: string): unknown => {
      const expression = createExpression(
        s57CodeListIncludesExpression("condition", CONDITION_RUINED),
        "test",
      );
      if (expression.result === "error") throw new Error(expression.value.join(", "));
      return expression.value.evaluate({ zoom: 16 }, {
        type: "Polygon",
        properties: condition === undefined ? {} : { condition },
      });
    };
    expect(ruined("2")).toBe(true);
    // A code sharing the property with another still matches, and a code that
    // merely contains the digit does not.
    expect(ruined("1,2")).toBe(true);
    expect(ruined("2,1")).toBe(true);
    expect(ruined("12")).toBe(false);
    expect(ruined("1")).toBe(false);
    expect(ruined()).toBe(false);
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
