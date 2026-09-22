/**
 * A tiny rasterizer for the chart symbols the app draws itself.
 *
 * The symbols are simple analytic shapes, so describing each as a predicate over
 * style pixels and supersampling the edges keeps them crisp at any device pixel
 * ratio without shipping sprite artwork. `light-icon` rasterizes its flare the
 * same way; this module is the shared part.
 */

/** Raw RGBA image data in the shape `Map.addImage` accepts. */
export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type Rgb = readonly [number, number, number];

/** A point in style pixels, with the origin at the image's top-left corner. */
export type Point = readonly [number, number];

/**
 * One drawn shape. Later shapes paint over earlier ones, so an outlined symbol
 * is the outline shape followed by the inset fill.
 */
export type IconShape = {
  readonly color: Rgb;
  /** Opacity of the shape, 0 through 1. Defaults to fully opaque. */
  readonly opacity?: number;
  /** Whether the point, in style pixels, lies inside the shape. */
  readonly covers: (x: number, y: number) => boolean;
};

/** Device pixels per style pixel in the generated images. */
export const ICON_PIXEL_RATIO = 3;

const SUBSAMPLES = 3;

/**
 * Rasterizes a square icon of `sizePixels` style pixels. Each shape's edge is
 * supersampled, and the shapes composite source-over in the order given.
 */
export function renderIcon(
  sizePixels: number,
  shapes: readonly IconShape[],
  pixelRatio: number = ICON_PIXEL_RATIO,
): RgbaImage {
  const size = Math.round(sizePixels * pixelRatio);
  const data = new Uint8Array(size * size * 4);
  const step = 1 / pixelRatio;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (const shape of shapes) {
        const covered = coverage(shape.covers, column * step, row * step, step)
          * (shape.opacity ?? 1);
        if (covered === 0) continue;
        red = shape.color[0] * covered + red * (1 - covered);
        green = shape.color[1] * covered + green * (1 - covered);
        blue = shape.color[2] * covered + blue * (1 - covered);
        alpha = covered + alpha * (1 - covered);
      }
      if (alpha === 0) continue;
      const offset = (row * size + column) * 4;
      data[offset] = Math.round(red);
      data[offset + 1] = Math.round(green);
      data[offset + 2] = Math.round(blue);
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, data };
}

/** A filled disc. */
export function disc(centreX: number, centreY: number, radius: number) {
  return (x: number, y: number): boolean => (
    (x - centreX) ** 2 + (y - centreY) ** 2 <= radius ** 2
  );
}

/** A ring of the given half-width around a circle. */
export function ring(centreX: number, centreY: number, radius: number, halfWidth: number) {
  return (x: number, y: number): boolean => {
    const distance = Math.hypot(x - centreX, y - centreY);
    return Math.abs(distance - radius) <= halfWidth;
  };
}

/** A stroke of the given half-width from one point to another, with rounded ends. */
export function stroke(from: Point, to: Point, halfWidth: number) {
  const [fromX, fromY] = from;
  const spanX = to[0] - fromX;
  const spanY = to[1] - fromY;
  const lengthSquared = spanX * spanX + spanY * spanY;
  return (x: number, y: number): boolean => {
    const alongRaw = lengthSquared === 0
      ? 0
      : ((x - fromX) * spanX + (y - fromY) * spanY) / lengthSquared;
    const along = Math.min(Math.max(alongRaw, 0), 1);
    return Math.hypot(x - (fromX + along * spanX), y - (fromY + along * spanY)) <= halfWidth;
  };
}

/** A filled polygon, by the even-odd rule. */
export function polygon(points: readonly Point[]) {
  return (x: number, y: number): boolean => {
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const [currentX, currentY] = points[index] ?? [0, 0];
      const [previousX, previousY] = points[previous] ?? [0, 0];
      const crosses = currentY > y !== previousY > y;
      if (!crosses) continue;
      const crossingX = currentX + ((y - currentY) / (previousY - currentY)) * (previousX - currentX);
      if (x < crossingX) inside = !inside;
    }
    return inside;
  };
}

/** The same polygon scaled about its mean vertex, for an inset fill inside an outline. */
export function insetPolygon(points: readonly Point[], factor: number): Point[] {
  const centreX = points.reduce((total, [x]) => total + x, 0) / points.length;
  const centreY = points.reduce((total, [, y]) => total + y, 0) / points.length;
  return points.map(([x, y]) => [
    centreX + (x - centreX) * factor,
    centreY + (y - centreY) * factor,
  ] as Point);
}

/** The union of several shapes. */
export function union(...shapes: readonly ((x: number, y: number) => boolean)[]) {
  return (x: number, y: number): boolean => shapes.some((shape) => shape(x, y));
}

function coverage(
  covers: (x: number, y: number) => boolean,
  x: number,
  y: number,
  step: number,
): number {
  let covered = 0;
  for (let row = 0; row < SUBSAMPLES; row += 1) {
    for (let column = 0; column < SUBSAMPLES; column += 1) {
      const sampleX = x + (step * (column + 0.5)) / SUBSAMPLES;
      const sampleY = y + (step * (row + 0.5)) / SUBSAMPLES;
      if (covers(sampleX, sampleY)) covered += 1;
    }
  }
  return covered / (SUBSAMPLES * SUBSAMPLES);
}
