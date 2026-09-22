import type { ChartFeatureProperties } from "./chart-features";

/**
 * How specific a tap on a layer is. A depth sounding is a point you aim at; a
 * restricted area is the water you happen to be over. Both answer a tap in the
 * same place, so one has to win, and it should be the one you aimed at.
 */
export const POINT_FEATURE = 0;
export const LINE_FEATURE = 1;
export const AREA_FEATURE = 2;

export type ChartInteraction = {
  readonly layerId: string;
  /** Layers of this kind across overlapping cells, whose hits merge into one popup. */
  readonly peerPrefix: string;
  readonly precedence: number;
  readonly format: (properties: ChartFeatureProperties) => string;
};

/** A rendered feature, narrowed to what choosing between them needs. */
export type QueriedFeature = {
  readonly layer: { readonly id: string };
  readonly properties: ChartFeatureProperties | null;
};

export type ChosenInteraction = {
  readonly interaction: ChartInteraction;
  readonly properties: readonly ChartFeatureProperties[];
};

/**
 * Picks the one feature group a tap should describe, out of everything rendered
 * under it. Without this each layer answers for itself and a tap inside an area
 * stacks a second popup behind the first, where it reads as one garbled one.
 *
 * `features` arrives topmost first, which decides ties within a precedence.
 * Coarser fallback cells stay rendered beneath detailed coverage, so hits on the
 * same kind of feature from several cells merge rather than compete.
 */
export function chooseInteraction(
  features: readonly QueriedFeature[],
  interactions: readonly ChartInteraction[],
): ChosenInteraction | undefined {
  const byLayerId = new Map(interactions.map((interaction) => [interaction.layerId, interaction]));
  const hits = features.flatMap((feature) => {
    const interaction = byLayerId.get(feature.layer.id);
    return interaction === undefined || feature.properties === null ? [] : [{ interaction, feature }];
  });
  const winner = hits.reduce<typeof hits[number] | undefined>(
    (best, hit) => best === undefined || hit.interaction.precedence < best.interaction.precedence ? hit : best,
    undefined,
  );
  if (winner === undefined) return undefined;

  const properties = hits
    .filter((hit) => hit.interaction.peerPrefix === winner.interaction.peerPrefix)
    .map((hit) => hit.feature.properties)
    .filter((candidate): candidate is ChartFeatureProperties => candidate !== null);
  return { interaction: winner.interaction, properties };
}
