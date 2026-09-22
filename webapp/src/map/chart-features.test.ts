import { describe, expect, it } from "vitest";
import {
  formatAnchorageDetails,
  formatBuoyDetails,
  formatCableDetails,
  formatDangerDetails,
  formatFeatureDetailsList,
  formatHarbourFacilityDetails,
  formatLandmarkDetails,
  formatMooringDetails,
  formatRestrictedAreaDetails,
  formatShorelineStructureDetails,
  LANDMARK_HEIGHT_LABEL,
} from "./chart-features";
import { formatLightDetails, LIGHT_HEIGHT_LABEL } from "./light";

describe("buoy details", () => {
  it("names the buoy, its category, shape and colours", () => {
    expect(formatBuoyDetails({
      name: "PS",
      kind: "lateral",
      category: "1",
      shape: "2",
      color: "3,1",
      colorPattern: "1",
    })).toBe([
      "PS",
      "Lateral buoy",
      "Category: port-hand lateral mark",
      "Shape: can (cylindrical)",
      "Color: red, white",
      "Color pattern: horizontal stripes",
    ].join("\n"));
  });

  it("reads the category against the attribute the buoy class uses", () => {
    expect(formatBuoyDetails({ kind: "cardinal", category: "2" }))
      .toBe("Cardinal buoy\nCategory: east cardinal mark");
    expect(formatBuoyDetails({ kind: "special-purpose", category: "20" }))
      .toBe("Special purpose buoy\nCategory: anchoring prohibited mark");
  });

  it("leaves out a category for the classes that carry none", () => {
    expect(formatBuoyDetails({ kind: "safe-water", shape: "3" }))
      .toBe("Safe water buoy\nShape: spherical");
    expect(formatBuoyDetails({ kind: "isolated-danger" })).toBe("Isolated danger buoy");
  });
});

describe("danger details", () => {
  it("converts a sounded depth into the package display unit", () => {
    expect(formatDangerDetails({
      name: "Sevona",
      kind: "wreck",
      category: "2",
      depth: 6.4,
      waterLevel: "3",
      soundingQuality: "6",
    }, "foot")).toBe([
      "Sevona",
      "Wreck",
      "Category: dangerous wreck",
      "Depth: 21.0 feet",
      "Water level: always under water/submerged",
      "Sounding quality: least depth known",
    ].join("\n"));
    expect(formatDangerDetails({ kind: "wreck", depth: 6.4 }, "metre"))
      .toBe("Wreck\nDepth: 6.4 metres");
  });

  it("gives a rock no category, because rocks carry none", () => {
    expect(formatDangerDetails({ kind: "rock", waterLevel: "5" }, "metre"))
      .toBe("Rock\nWater level: awash");
  });
});

describe("area and facility details", () => {
  it("names a harbour facility and its category", () => {
    expect(formatHarbourFacilityDetails({
      name: "Port Superior Village Marina",
      category: "5",
    })).toBe("Port Superior Village Marina\nFacility: yacht harbour/marina");
  });

  it("names an anchorage", () => {
    expect(formatAnchorageDetails({ category: "7" }))
      .toBe("Anchorage\nCategory: small craft anchorage");
  });

  it("leads a restricted area with its anchoring rule", () => {
    expect(formatRestrictedAreaDetails({
      kind: "restricted",
      anchoring: "prohibited",
      restriction: "1,3",
      category: "24",
    })).toBe([
      "Restricted area",
      "Anchoring prohibited",
      "Restrictions: anchoring prohibited, fishing prohibited",
      "Category: no wake area",
    ].join("\n"));
  });

  it("cites the regulation behind a restriction the tables cannot name", () => {
    // Where S-57 published no meaning for the code, NOAA's own INFORM value is
    // the only account of the rule, so the popup has to carry it.
    expect(formatRestrictedAreaDetails({
      kind: "restricted",
      restriction: "22,2,10",
      information: "Protected area,15 CFR 922",
      name: "Wisconsin Shipwreck Coast National Marine Sanctuary",
      anchoring: "restricted",
    })).toBe([
      "Wisconsin Shipwreck Coast National Marine Sanctuary",
      "Restricted area",
      "Anchoring restricted",
      "Restrictions: restriction 22, anchoring restricted, dredging restricted",
      "Authority: Protected area,15 CFR 922",
    ].join("\n"));
  });

  it("prints a restriction code the published table does not define", () => {
    // RESTRN 24 has no entry anywhere in the S-57 tables GDAL ships. Showing the
    // code is the only honest option; guessing at wording here is not acceptable.
    expect(formatRestrictedAreaDetails({ kind: "cable-area", restriction: "2,6,24" })).toBe([
      "Cable area",
      "Restrictions: anchoring restricted, trawling restricted, restriction 24",
    ].join("\n"));
  });

  it("names a cable and a pipeline from their own category attributes", () => {
    expect(formatCableDetails({ kind: "cable", category: "1" }))
      .toBe("Submarine cable\nCategory: power line");
    expect(formatCableDetails({ kind: "pipeline", name: "Outfall", category: "2" }))
      .toBe("Outfall\nSubmarine pipeline\nCategory: outfall pipe");
  });
});

describe("shoreline structure details", () => {
  it("leads with the condition, because a ruined pier is not a berth", () => {
    expect(formatShorelineStructureDetails({
      name: "Raspberry Island Dock",
      kind: "construction",
      category: "4",
      condition: "2",
      waterLevel: "2",
    })).toBe([
      "Raspberry Island Dock",
      "Shoreline structure",
      "Condition: ruined",
      "Category: pier ( jetty)",
      "Water level: always dry",
    ].join("\n"));
  });

  it("names armouring as what it is", () => {
    expect(formatShorelineStructureDetails({ kind: "construction", category: "8" }))
      .toBe("Shoreline structure\nCategory: rip rap");
    expect(formatShorelineStructureDetails({ kind: "construction", category: "10" }))
      .toBe("Shoreline structure\nCategory: sea wall");
  });

  it("never describes a floating dry dock as a berth", () => {
    // `FLODOC` is a shipyard structure. A pontoon is the floating dock a vessel
    // does lie against, so the two must not share a heading.
    const floatingDock = formatShorelineStructureDetails({ kind: "floating-dock" });
    expect(floatingDock).toBe("Floating dry dock");
    expect(floatingDock).not.toContain("Pontoon");
    expect(formatShorelineStructureDetails({ kind: "pontoon", waterLevel: "1" }))
      .toBe("Pontoon\nWater level: partly submerged at high water");
  });

  it("reads no category on a class S-57 gives none", () => {
    // `CATSLC` belongs to `SLCONS` alone, so a code arriving on a pontoon or a
    // floating dock is not a shoreline construction category and is not shown.
    expect(formatShorelineStructureDetails({ kind: "pontoon", category: "4" })).toBe("Pontoon");
    expect(formatShorelineStructureDetails({ kind: "floating-dock", category: "4" }))
      .toBe("Floating dry dock");
  });

  it("names a mooring facility and its category", () => {
    expect(formatMooringDetails({ category: "1" }))
      .toBe("Mooring facility\nCategory: dolphin");
    expect(formatMooringDetails({ name: "Pile mooring", category: "5", condition: "2" }))
      .toBe("Pile mooring\nMooring facility\nCondition: ruined\nCategory: post or pile");
  });
});

describe("details for every feature under a tap", () => {
  it("drops duplicates, which overlapping cells produce", () => {
    const buoy = { kind: "lateral", category: "2", shape: "1", color: "4" };
    expect(formatFeatureDetailsList([buoy, { ...buoy }], formatBuoyDetails))
      .toBe("Lateral buoy\nCategory: starboard-hand lateral mark\nShape: conical (nun, ogival)\nColor: green");
  });

  it("separates distinct features with a blank line", () => {
    const details = formatFeatureDetailsList(
      [{ kind: "rock" }, { kind: "obstruction", category: "6" }],
      (properties) => formatDangerDetails(properties, "metre"),
    );
    expect(details).toBe("Rock\n\nObstruction\nCategory: foul area");
  });
});

describe("landmark details", () => {
  it("names a lighthouse structure from its function, not its category", () => {
    // Devils Island Light, US4WI1QF: CATLMK 17, FUNCTN 33, HEIGHT 30.5, CONVIS 1.
    expect(formatLandmarkDetails({
      name: "Devils Island Light",
      category: "17",
      function: "33",
      heightMetres: 30.5,
      conspicuous: 1,
    })).toBe([
      "Devils Island Light",
      "Light support",
      "Visually conspicuous",
      "Category: tower",
      "Function: light support",
      "Structure height: 30.5 metres",
    ].join("\n"));

    // A light support is not always a tower: US5MKEDC carries them as a
    // chimney and as a dome, and a multi-valued FUNCTN arrives as a list.
    expect(formatLandmarkDetails({ category: "3", function: "30,33" })).toBe([
      "Light support",
      "Category: chimney",
      "Function: television, light support",
    ].join("\n"));
    expect(formatLandmarkDetails({ category: "15", function: "33" }))
      .toContain("Light support");
  });

  it("tells an ordinary landmark apart from one carrying a light", () => {
    const mast = formatLandmarkDetails({ name: "WXYZ", category: "7", function: "31" });
    expect(mast).toBe("WXYZ\nLandmark\nCategory: mast\nFunction: radio");
    expect(mast).not.toContain("Light support");
    expect(formatLandmarkDetails({ category: "20" })).toBe("Landmark\nCategory: spire/minaret");
  });

  it("keeps an undocumented landmark code as a code", () => {
    expect(formatLandmarkDetails({ category: "21", function: "43" }))
      .toBe("Landmark\nCategory: landmark category 21\nFunction: function 43");
  });

  it("drops the height line rather than printing a height it does not have", () => {
    // Gull Island and Raspberry Island Lights carry FUNCTN 33 and no HEIGHT.
    const noHeight = formatLandmarkDetails({ name: "Gull Island Light", function: "33" });
    expect(noHeight).toBe("Gull Island Light\nLight support\nFunction: light support");
    expect(noHeight).not.toContain(LANDMARK_HEIGHT_LABEL);
    expect(noHeight).not.toContain("undefined");
    expect(formatLandmarkDetails({ function: "33", heightMetres: null }))
      .not.toContain(LANDMARK_HEIGHT_LABEL);
    // Michigan Island Light is 3.4 m; Outer Island Light 39.6 m.
    expect(formatLandmarkDetails({ heightMetres: 3.4 })).toContain("Structure height: 3.4 metres");
    expect(formatLandmarkDetails({ heightMetres: 12 })).toContain("Structure height: 12 metres");
  });
});

describe("the two heights of one lighthouse", () => {
  it("never labels the structure height and the focal plane elevation alike", () => {
    // `landmark.heightMetres` is the height of the structure;
    // `light.heightMetres` is the elevation of the light's focal plane. They
    // are different measurements of the same lighthouse and neither popup may
    // say a bare "Height", which would invite reading one for the other.
    expect(LANDMARK_HEIGHT_LABEL).not.toBe(LIGHT_HEIGHT_LABEL);
    expect(LANDMARK_HEIGHT_LABEL).not.toContain(LIGHT_HEIGHT_LABEL);
    expect(LIGHT_HEIGHT_LABEL).not.toContain(LANDMARK_HEIGHT_LABEL);
    for (const label of [LANDMARK_HEIGHT_LABEL, LIGHT_HEIGHT_LABEL]) {
      expect(label).not.toBe("Height");
    }

    // The same lighthouse, described through both layers at one position.
    const tower = formatLandmarkDetails({
      name: "Devils Island Light",
      category: "17",
      function: "33",
      heightMetres: 30.5,
    });
    const light = formatLightDetails({ characteristic: 2, heightMetres: 25.9 });
    expect(tower).toContain("Structure height: 30.5 metres");
    expect(light).toContain("Focal plane elevation: 25.9 metres");
    expect(tower).not.toMatch(/(^|\n)Height:/);
    expect(light).not.toMatch(/(^|\n)Height:/);
    expect(light).not.toContain(LANDMARK_HEIGHT_LABEL);
    expect(tower).not.toContain(LIGHT_HEIGHT_LABEL);
  });
});
