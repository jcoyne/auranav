export type LightProperties = {
  color?: unknown;
  characteristic?: unknown;
  signalGroup?: unknown;
  periodSeconds?: unknown;
  heightMetres?: unknown;
  nominalRangeNm?: unknown;
  sectorStart?: unknown;
  sectorEnd?: unknown;
  orientation?: unknown;
  heightDatum?: unknown;
};

/**
 * How a light's own height is labelled.
 *
 * `light.heightMetres` is the elevation of the light's focal plane above the
 * vertical datum named by `heightDatum`. The lighthouse structure carrying it
 * is a `landmark` with a `heightMetres` of its own, which is the height of the
 * structure. Two measurements of one lighthouse: a bare "Height" on either
 * popup would invite reading one for the other, so each says which it is. See
 * `LANDMARK_HEIGHT_LABEL` in `chart-features.ts`.
 */
export const LIGHT_HEIGHT_LABEL = "Focal plane elevation";

const COLOR_ABBREVIATIONS: Record<string, string> = {
  white: "W",
  red: "R",
  green: "G",
  blue: "Bu",
  yellow: "Y",
  amber: "Am",
  violet: "Vi",
  orange: "Or",
};

const CHARACTERISTIC_NAMES: Record<string, string> = {
  F: "Fixed",
  Fl: "Flashing",
  LFl: "Long flashing",
  Q: "Quick flashing",
  VQ: "Very quick flashing",
  UQ: "Ultra quick flashing",
  Iso: "Isophase",
  Oc: "Occulting",
  IQ: "Interrupted quick flashing",
  IVQ: "Interrupted very quick flashing",
  IUQ: "Interrupted ultra quick flashing",
  Mo: "Morse code",
  Al: "Alternating",
  "F.Fl": "Fixed and flashing",
  "F.LFl": "Fixed and long flashing",
  "Oc.Fl": "Occulting and flashing",
  "Oc.LFl": "Occulting and long flashing",
  "Al.Oc": "Occulting alternating",
  "Al.LFl": "Long flashing alternating",
  "Al.Fl": "Flashing alternating",
  "Al.Gr": "Group alternating",
  "2F Vert": "Two fixed lights, vertical",
  "2F Hor": "Two fixed lights, horizontal",
  "3F Vert": "Three fixed lights, vertical",
  "3F Hor": "Three fixed lights, horizontal",
  "Q+LFl": "Quick flashing plus long flashing",
  "VQ+LFl": "Very quick flashing plus long flashing",
  "UQ+LFl": "Ultra quick flashing plus long flashing",
  "F.Al.Fl": "Fixed and alternating flashing",
};

const CHARACTERISTIC_CODES: Record<string, string> = {
  "1": "F", "2": "Fl", "3": "LFl", "4": "Q", "5": "VQ", "6": "UQ",
  "7": "Iso", "8": "Oc", "9": "IQ", "10": "IVQ", "11": "IUQ", "12": "Mo",
  "13": "F.Fl", "14": "F.LFl", "15": "Oc.Fl", "16": "Oc.LFl", "17": "Al.Oc",
  "18": "Al.LFl", "19": "Al.Fl", "20": "Al.Gr", "21": "2F Vert", "22": "2F Hor",
  "23": "3F Vert", "24": "3F Hor", "25": "Q+LFl", "26": "VQ+LFl",
  "27": "UQ+LFl", "28": "Al", "29": "F.Al.Fl",
};

const COLOR_CODES: Record<string, string> = {
  "1": "W", "2": "Bk", "3": "R", "4": "G", "5": "Bu", "6": "Y", "7": "Gy",
  "8": "Br", "9": "Am", "10": "Vi", "11": "Or", "12": "Ma", "13": "Pi",
};
const COLOR_NAMES: Record<string, string> = {
  "1": "White", "2": "Black", "3": "Red", "4": "Green", "5": "Blue", "6": "Yellow",
  "7": "Grey", "8": "Brown", "9": "Amber", "10": "Violet", "11": "Orange",
  "12": "Magenta", "13": "Pink",
};

export function formatLightLabel(properties: LightProperties): string {
  const characteristic = characteristicAbbreviation(properties.characteristic);
  const group = text(properties.signalGroup);
  const color = abbreviateColor(properties.color);
  const period = positiveNumber(properties.periodSeconds);
  const height = positiveNumber(properties.heightMetres);
  const range = positiveNumber(properties.nominalRangeNm);

  return [
    `${characteristic}${formatGroup(group)}`,
    color,
    period === undefined ? undefined : `${formatNumber(period)}s`,
    height === undefined ? undefined : `${formatNumber(height)}m`,
    range === undefined ? undefined : `${formatNumber(range)}M`,
  ].filter((part): part is string => part !== undefined).join(" ");
}

export function formatLightDetails(properties: LightProperties): string {
  const label = formatLightLabel(properties);
  const characteristic = scalarText(properties.characteristic);
  const color = codeList(properties.color);
  const group = text(properties.signalGroup);
  const period = positiveNumber(properties.periodSeconds);
  const height = positiveNumber(properties.heightMetres);
  const range = positiveNumber(properties.nominalRangeNm);
  const sectorStart = direction(properties.sectorStart);
  const sectorEnd = direction(properties.sectorEnd);
  const orientation = direction(properties.orientation);
  const heightDatum = scalarText(properties.heightDatum);
  const details = [
    characteristic === undefined ? undefined : `Characteristic: ${characteristicName(properties.characteristic)}`,
    group === undefined ? undefined : `Group: ${group}`,
    color === undefined ? undefined : `Color: ${expandColor(color)}`,
    period === undefined ? undefined : `Period: ${formatNumber(period)} seconds`,
    height === undefined ? undefined : `${LIGHT_HEIGHT_LABEL}: ${formatNumber(height)} metres`,
    range === undefined ? undefined : `Nominal range: ${formatNumber(range)} nautical miles`,
    sectorStart === undefined && sectorEnd === undefined
      ? undefined
      : `Sector: ${formatDirection(sectorStart)}–${formatDirection(sectorEnd)}`,
    orientation === undefined ? undefined : `Orientation: ${formatDirection(orientation)}`,
    heightDatum === undefined
      ? undefined
      : `Height datum: ${/^\d+$/.test(heightDatum) ? `S-57 code ${heightDatum}` : heightDatum}`,
  ].filter((part): part is string => part !== undefined);
  return [label, ...details].join("\n");
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value.toString();
  return text(value);
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function direction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 360) return undefined;
  return value;
}

function formatDirection(value: number | undefined): string {
  if (value === undefined) return "unknown";
  const normalized = value === 360 ? 0 : value;
  const formatted = Number.isInteger(normalized)
    ? normalized.toString().padStart(3, "0")
    : normalized.toFixed(1).padStart(5, "0");
  return `${formatted}°`;
}

function formatGroup(group: string | undefined): string {
  if (group === undefined) return "";
  if (group === "()" || group === "( )" || group === "(1)" || group === "1") return "";
  if (group.startsWith("(") && group.endsWith(")")) return group;
  return `(${group})`;
}

function characteristicAbbreviation(value: unknown): string {
  const raw = typeof value === "number" ? value.toString() : text(value);
  if (raw === undefined) return "Lt";
  return CHARACTERISTIC_CODES[raw] ?? raw;
}

function characteristicName(value: unknown): string {
  const abbreviation = characteristicAbbreviation(value);
  return CHARACTERISTIC_NAMES[abbreviation] ?? abbreviation;
}

function abbreviateColor(color: unknown): string | undefined {
  return codeList(color)?.map((part) => (
    COLOR_CODES[part] ?? COLOR_ABBREVIATIONS[part.toLowerCase()] ?? part
  )).join(" ");
}

function expandColor(parts: string[]): string {
  const names = Object.entries(COLOR_ABBREVIATIONS);
  return parts.map((part) => {
    if (COLOR_NAMES[part] !== undefined) return COLOR_NAMES[part];
    const match = names.find(([, abbreviation]) => abbreviation.toLowerCase() === part.toLowerCase());
    if (match) return match[0].replace(/^./, (letter) => letter.toUpperCase());
    return part.replace(/^./, (letter) => letter.toUpperCase());
  }).join(" / ");
}

function codeList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.flatMap((part) => typeof part === "string" || typeof part === "number"
      ? [String(part).trim()]
      : []);
    return values.length === 0 ? undefined : values;
  }
  if (typeof value === "number") return [value.toString()];
  const raw = text(value);
  if (raw === undefined) return undefined;
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      return codeList(JSON.parse(raw));
    } catch {
      // Fall through for malformed producer-specific list encodings.
    }
  }
  return raw.split(/[,/]+/).map((part) => part.trim()).filter(Boolean);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, "");
}
