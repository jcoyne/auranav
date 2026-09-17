import type { FeatureCollection, LineString, Point, Polygon } from "geojson";

type ChartProperties = {
  cell: string;
  usageBand: number;
  compilationScale: number;
};

type DepthProperties = ChartProperties & {
  depth: number;
};

type DepthAreaProperties = ChartProperties & {
  minimumDepth: number;
  maximumDepth: number;
};

const chartProperties: ChartProperties = {
  cell: "US5WI001",
  usageBand: 5,
  compilationScale: 20_000,
};

// Synthetic geometry near Milwaukee. It is deliberately not copied from a
// navigation chart and must never be presented as real hydrographic data.
export const demoCoastline: FeatureCollection<LineString, ChartProperties> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: chartProperties,
      geometry: {
        type: "LineString",
        coordinates: [
          [-87.931, 43.105],
          [-87.906, 43.075],
          [-87.895, 43.043],
          [-87.884, 43.008],
          [-87.876, 42.98],
        ],
      },
    },
  ],
};

export const demoDepthAreas: FeatureCollection<Polygon, DepthAreaProperties> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { ...chartProperties, minimumDepth: 0, maximumDepth: 6 },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-87.931, 43.105], [-87.906, 43.075], [-87.895, 43.043],
          [-87.884, 43.008], [-87.876, 42.98], [-87.82, 42.98],
          [-87.82, 43.105], [-87.931, 43.105],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { ...chartProperties, minimumDepth: 6, maximumDepth: 20 },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-87.82, 42.98], [-87.82, 43.105], [-87.72, 43.105],
          [-87.72, 42.98], [-87.82, 42.98],
        ]],
      },
    },
  ],
};

export const demoDepthContours: FeatureCollection<LineString, DepthProperties> = {
  type: "FeatureCollection",
  features: [6, 12].map((depth, index) => ({
    type: "Feature",
    properties: { ...chartProperties, depth },
    geometry: {
      type: "LineString",
      coordinates: [
        [-87.87 + index * 0.05, 42.985],
        [-87.88 + index * 0.05, 43.035],
        [-87.89 + index * 0.05, 43.095],
      ],
    },
  })),
};

export const demoSoundings: FeatureCollection<Point, DepthProperties> = {
  type: "FeatureCollection",
  features: [
    [-87.858, 43.02, 4.8],
    [-87.84, 43.055, 7.2],
    [-87.79, 43.08, 13.1],
    [-87.78, 43.015, 15.4],
  ].map(([longitude, latitude, depth]) => ({
    type: "Feature",
    properties: { ...chartProperties, depth: depth! },
    geometry: { type: "Point", coordinates: [longitude!, latitude!] },
  })),
};
