import type { ExpressionSpecification } from "maplibre-gl";

/**
 * S-57 attribute value meanings, transcribed from the tables GDAL ships as
 * `s57attributes.csv` and `s57expectedinput.csv`.
 *
 * Those tables are authoritative where they have an entry and incomplete where
 * they do not: `RESTRN` stops at 15 while NOAA cells also use 16, 17, 22 and 24,
 * and `CATREA` has gaps of its own. A code with no entry is shown as the bare
 * code, never as a guess, because inventing restriction wording on a chart is
 * not a presentation decision a viewer may make.
 */
export type S57Attribute =
  | "BOYSHP"
  | "CATACH"
  | "CATCAM"
  | "CATCBL"
  | "CATHAF"
  | "CATLAM"
  | "CATMOR"
  | "CATOBS"
  | "CATPIP"
  | "CATREA"
  | "CATSLC"
  | "CATSPM"
  | "CATWRK"
  | "COLOUR"
  | "COLPAT"
  | "CONDTN"
  | "QUASOU"
  | "RESTRN"
  | "WATLEV";

/** `CONDTN` 2. A ruin is not something to tie to, so the style reads it too. */
export const CONDITION_RUINED = "2";

type S57AttributeTable = {
  /** Used both as a popup heading and as the wording of an unknown code. */
  readonly label: string;
  readonly meanings: Readonly<Record<string, string>>;
};

const S57_ATTRIBUTES: Readonly<Record<S57Attribute, S57AttributeTable>> = {
  BOYSHP: {
    label: "buoy shape",
    meanings: {
      "1": "conical (nun, ogival)",
      "2": "can (cylindrical)",
      "3": "spherical",
      "4": "pillar",
      "5": "spar (spindle)",
      "6": "barrel (tun)",
      "7": "super-buoy",
      "8": "ice buoy",
    },
  },
  CATACH: {
    label: "anchorage category",
    meanings: {
      "1": "unrestricted anchorage",
      "2": "deep water anchorage",
      "3": "tanker anchorage",
      "4": "explosives anchorage",
      "5": "quarantine anchorage",
      "6": "sea-plane anchorage",
      "7": "small craft anchorage",
      "8": "small craft mooring area",
      "9": "anchorage for periods up to 24 hours",
    },
  },
  CATCAM: {
    label: "cardinal mark",
    meanings: {
      "1": "north cardinal mark",
      "2": "east cardinal mark",
      "3": "south cardinal mark",
      "4": "west cardinal mark",
    },
  },
  CATCBL: {
    label: "cable category",
    meanings: {
      "1": "power line",
      "3": "transmission line",
      "4": "telephone",
      "5": "telegraph",
      "6": "mooring cable/chain",
    },
  },
  CATHAF: {
    label: "harbour facility",
    meanings: {
      "1": "RoRo-terminal",
      "3": "ferry terminal",
      "4": "fishing harbour",
      "5": "yacht harbour/marina",
      "6": "naval base",
      "7": "tanker terminal",
      "8": "passenger terminal",
      "9": "shipyard",
      "10": "container terminal",
      "11": "bulk terminal",
    },
  },
  CATLAM: {
    label: "lateral mark",
    meanings: {
      "1": "port-hand lateral mark",
      "2": "starboard-hand lateral mark",
      "3": "preferred channel to starboard lateral mark",
      "4": "preferred channel to port lateral mark",
    },
  },
  CATMOR: {
    label: "mooring facility",
    meanings: {
      "1": "dolphin",
      "2": "deviation dolphin",
      "3": "bollard",
      "4": "tie-up wall",
      "5": "post or pile",
      "6": "chain/wire/cable",
      "7": "mooring buoy",
    },
  },
  CATOBS: {
    label: "obstruction category",
    meanings: {
      "1": "snag / stump",
      "2": "wellhead",
      "3": "diffuser",
      "4": "crib",
      "5": "fish haven",
      "6": "foul area",
      "7": "foul ground",
      "8": "ice boom",
      "9": "ground tackle",
    },
  },
  CATPIP: {
    label: "pipeline category",
    meanings: {
      "2": "outfall pipe",
      "3": "intake pipe",
      "4": "sewer",
      "5": "bubbler system",
      "6": "supply pipe",
    },
  },
  CATREA: {
    label: "restricted area category",
    meanings: {
      "1": "offshore safety zone",
      "4": "nature reserve",
      "5": "bird sanctuary",
      "6": "game preserve",
      "7": "seal sanctuary",
      "8": "degaussing range",
      "9": "military area",
      "10": "historic wreck area",
      "12": "navigational aid safety zone",
      "14": "minefield",
      "18": "swimming area",
      "19": "waiting area",
      "20": "research area",
      "21": "dredging area",
      "22": "fish sanctuary",
      "23": "ecological reserve",
      "24": "no wake area",
      "25": "swinging area",
    },
  },
  CATSLC: {
    label: "shoreline construction",
    meanings: {
      "1": "breakwater",
      "2": "groyne (groin)",
      "3": "mole",
      // Transcribed as the table prints it, stray space included, so the
      // wording on the chart is traceably the published wording.
      "4": "pier ( jetty)",
      "5": "promenadepier",
      "6": "wharf (quay)",
      "7": "training wall",
      "8": "rip rap",
      "9": "revetment",
      "10": "sea wall",
      "11": "landing steps",
      "12": "ramp",
      "13": "slipway",
      "14": "fender",
      "15": "solid face wharf",
      "16": "open face wharf",
    },
  },
  CATSPM: {
    label: "special purpose mark",
    meanings: {
      "1": "firing danger area mark",
      "2": "target mark",
      "3": "marker ship mark",
      "4": "degaussing range mark",
      "5": "barge mark",
      "6": "cable mark",
      "7": "spoil ground mark",
      "8": "outfall mark",
      "9": "ODAS (Ocean-Data-Acquisition-System)",
      "10": "recording mark",
      "11": "seaplane anchorage mark",
      "12": "recreation zone mark",
      "13": "private mark",
      "14": "mooring mark",
      "15": "LANBY (Large Automatic Navigational Buoy)",
      "16": "leading mark",
      "17": "measured distance mark",
      "18": "notice mark",
      "19": "TSS mark (Traffic Separation Scheme)",
      "20": "anchoring prohibited mark",
      "21": "berthing prohibited mark",
      "22": "overtaking prohibited mark",
      "23": "two-way traffic prohibited mark",
      "24": "'reduced wake' mark",
      "25": "speed limit mark",
      "26": "stop mark",
      "27": "general warning mark",
      "28": "'sound ship's siren' mark",
      "29": "restricted vertical clearence mark",
      "30": "maximum vessel's draught mark",
      "31": "restricted horizontal clearance mark",
      "32": "strong current warning mark",
      "33": "berthing permitted mark",
      "34": "overhead power cable mark",
      "35": "'channel edge gradient' mark",
      "36": "telephone mark",
      "37": "ferry crossing mark",
      "39": "pipline mark",
      "40": "anchorage mark",
      "41": "clearing mark",
      "42": "control mark",
      "43": "diving mark",
      "44": "refuge beacon",
      "45": "foul ground mark",
      "46": "yachting mark",
      "47": "heliport mark",
      "48": "GPS mark",
      "49": "seaplane landing mark",
      "50": "entry prohibited mark",
      "51": "work in progress mark",
      "52": "mark with unknown purpose",
    },
  },
  CATWRK: {
    label: "wreck category",
    meanings: {
      "1": "non-dangerous wreck",
      "2": "dangerous wreck",
      "3": "distributed remains of wreck",
      "4": "wreck showing mast/masts",
      "5": "wreck showing any portion of hull or superstructure",
    },
  },
  COLOUR: {
    label: "color",
    meanings: {
      "1": "white",
      "2": "black",
      "3": "red",
      "4": "green",
      "5": "blue",
      "6": "yellow",
      "7": "grey",
      "8": "brown",
      "9": "amber",
      "10": "violet",
      "11": "orange",
      "12": "magenta",
      "13": "pink",
    },
  },
  COLPAT: {
    label: "color pattern",
    meanings: {
      "1": "horizontal stripes",
      "2": "vertical stripes",
      "3": "diagonal stripes",
      "4": "squared",
      "5": "stripes (direction unknown)",
      "6": "border stripes",
    },
  },
  CONDTN: {
    label: "condition",
    meanings: {
      "1": "under construction",
      "2": "ruined",
      "3": "under reclamation",
      "4": "wingless",
      "5": "planned construction",
    },
  },
  QUASOU: {
    label: "sounding quality",
    meanings: {
      "1": "depth known",
      "2": "depth unknown",
      "3": "doubtful sounding",
      "4": "unreliable sounding",
      "5": "no bottom found at value shown",
      "6": "least depth known",
      "7": "least depth unknown, safe clearance at value shown",
      "8": "value reported (not surveyed)",
      "9": "value reported (not confirmed)",
      "10": "maintained depth",
      "11": "not reguraly maintained",
    },
  },
  RESTRN: {
    label: "restriction",
    meanings: {
      "1": "anchoring prohibited",
      "2": "anchoring restricted",
      "3": "fishing prohibited",
      "4": "fishing restricted",
      "5": "trawling prohibited",
      "6": "trawling restricted",
      "7": "entry prohibited",
      "8": "entry restricted",
      "9": "dredging prohibited",
      "10": "dredging restricted",
      "11": "diving prohibited",
      "12": "diving restricted",
      "13": "no wake",
      "14": "area to be avoided",
      "15": "construction prohibited",
    },
  },
  WATLEV: {
    label: "water level",
    meanings: {
      "1": "partly submerged at high water",
      "2": "always dry",
      "3": "always under water/submerged",
      "4": "covers and uncovers",
      "5": "awash",
      "6": "subject to inundation or flooding",
    },
  },
};

/** The human label for an attribute, as used in popup headings. */
export function s57AttributeLabel(attribute: S57Attribute): string {
  return S57_ATTRIBUTES[attribute].label;
}

/** The documented meaning of one code, or `undefined` when no table entry exists. */
export function s57Meaning(attribute: S57Attribute, code: string): string | undefined {
  return S57_ATTRIBUTES[attribute].meanings[code.trim()];
}

/**
 * One code as text. An undocumented code reads as `restriction 24` rather than
 * as the nearest documented meaning, which would be a fabrication.
 */
export function describeS57Code(attribute: S57Attribute, code: string): string {
  const trimmed = code.trim();
  return s57Meaning(attribute, trimmed) ?? `${S57_ATTRIBUTES[attribute].label} ${trimmed}`;
}

/**
 * Splits a tile property into S-57 codes. The pipeline reduces a list-valued
 * attribute to a comma-separated string, and a single-valued one passes through.
 */
export function parseS57CodeList(value: unknown): string[] {
  if (typeof value === "number" && Number.isFinite(value)) return [value.toString()];
  if (typeof value !== "string") return [];
  return value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Every code in a list as text, or `undefined` when the property is absent or empty. */
export function describeS57CodeList(attribute: S57Attribute, value: unknown): string | undefined {
  const codes = parseS57CodeList(value);
  if (codes.length === 0) return undefined;
  return codes.map((code) => describeS57Code(attribute, code)).join(", ");
}

/** Whether a code-list property carries one particular code. */
export function s57CodeListIncludes(value: unknown, code: string): boolean {
  return parseS57CodeList(value).includes(code);
}

/**
 * The same membership test as a style expression. Equality against the property
 * would miss a code that shares it with another, so the comma-delimited form is
 * searched for the whole delimited token rather than for the digits alone.
 */
export function s57CodeListIncludesExpression(
  property: string,
  code: string,
): ExpressionSpecification {
  return ["in", `,${code},`, ["concat", ",", ["to-string", ["get", property]], ","]];
}

/**
 * The first code of a code-list property, for a style expression that has to pick
 * one symbol. `"3,1"` is a red buoy with a white band; the symbol takes the red.
 */
export function firstS57CodeExpression(property: string): ExpressionSpecification {
  const value: ExpressionSpecification = ["to-string", ["get", property]];
  const separator: ExpressionSpecification = ["index-of", ",", value];
  return ["case", [">", separator, 0], ["slice", value, 0, separator], value];
}
