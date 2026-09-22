import { describe, expect, it } from "vitest";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import {
  CONDITION_RUINED,
  describeS57Code,
  describeS57CodeList,
  FUNCTION_LIGHT_SUPPORT,
  parseS57CodeList,
  s57AttributeLabel,
  s57CodeListIncludes,
  s57CodeListIncludesExpression,
  s57Meaning,
  VISUALLY_CONSPICUOUS,
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

  it("reads the landmark, function and conspicuity tables GDAL publishes", () => {
    expect(describeS57Code("CATLMK", "17")).toBe("tower");
    expect(describeS57Code("CATLMK", "7")).toBe("mast");
    expect(describeS57Code("CATLMK", "3")).toBe("chimney");
    expect(describeS57Code("CATLMK", "20")).toBe("spire/minaret");
    expect(describeS57Code("CATLMK", "15")).toBe("dome");
    expect(describeS57Code("CATLMK", "1")).toBe("cairn");
    expect(describeS57Code("FUNCTN", FUNCTION_LIGHT_SUPPORT)).toBe("light support");
    expect(describeS57Code("FUNCTN", "30")).toBe("television");
    expect(describeS57Code("FUNCTN", "42")).toBe("bus station");
    expect(describeS57Code("CONVIS", VISUALLY_CONSPICUOUS)).toBe("visual conspicuous");
    expect(describeS57Code("CONVIS", "2")).toBe("not visual conspicuous");
    // A mast carrying a light lists both functions, and both are named.
    expect(describeS57CodeList("FUNCTN", "30,33")).toBe("television, light support");
  });

  it("shows a bare code for a landmark, function or conspicuity code with no entry", () => {
    // `CATLMK` stops at 20, `FUNCTN` runs 2 through 42 with no code 1, and
    // `CONVIS` stops at 2. An undocumented code must not borrow a neighbour.
    expect(describeS57Code("CATLMK", "21")).toBe("landmark category 21");
    expect(describeS57Code("FUNCTN", "1")).toBe("function 1");
    expect(describeS57Code("FUNCTN", "43")).toBe("function 43");
    expect(describeS57Code("CONVIS", "3")).toBe("visual conspicuity 3");
    expect(s57Meaning("CATLMK", "21")).toBeUndefined();
    expect(s57Meaning("FUNCTN", "43")).toBeUndefined();
    expect(s57Meaning("CONVIS", "3")).toBeUndefined();
    expect(s57AttributeLabel("CATLMK")).toBe("landmark category");
    expect(s57AttributeLabel("FUNCTN")).toBe("function");
    expect(describeS57CodeList("FUNCTN", "33,43")).toBe("light support, function 43");
  });

  it("finds a light support inside a multi-valued function list", () => {
    // FUNCTN normalises to a comma list, so a light support arrives as "30,33"
    // as readily as as "33", and 33 must not be found inside 133 or 330.
    expect(s57CodeListIncludes("33", FUNCTION_LIGHT_SUPPORT)).toBe(true);
    expect(s57CodeListIncludes("30,33", FUNCTION_LIGHT_SUPPORT)).toBe(true);
    expect(s57CodeListIncludes("33,30", FUNCTION_LIGHT_SUPPORT)).toBe(true);
    expect(s57CodeListIncludes("30", FUNCTION_LIGHT_SUPPORT)).toBe(false);
    expect(s57CodeListIncludes("330", FUNCTION_LIGHT_SUPPORT)).toBe(false);
    expect(s57CodeListIncludes(undefined, FUNCTION_LIGHT_SUPPORT)).toBe(false);
    // `conspicuous` is single-valued, and arrives as a number as well as text.
    expect(s57CodeListIncludes(1, VISUALLY_CONSPICUOUS)).toBe(true);
    expect(s57CodeListIncludes("2", VISUALLY_CONSPICUOUS)).toBe(false);
    expect(s57CodeListIncludes(undefined, VISUALLY_CONSPICUOUS)).toBe(false);
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
