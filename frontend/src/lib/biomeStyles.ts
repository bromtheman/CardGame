import { ZONE_TYPES } from '@shared/gameSettings'

// These ARE the biome readout — the biome word is gone from the board panel.
// A tinted border does most of the work: a low-opacity fill over a dark navy
// page barely registers, an edge colour reads at a glance. Deliberately weaker
// than the solid brass border + ring that marks a legal drop target, so a land
// zone is never mistaken for a highlighted one.
//
// Lives here rather than in BoardZone so the lobby's BoardPreview shows the
// same colours as the board it previews.
export const BIOME_TINT: Record<string, string> = {
  [ZONE_TYPES.WATER]: 'bg-ocean-600/30',
  [ZONE_TYPES.BEACH]: 'bg-parchment-300/20',
  [ZONE_TYPES.LAND]: 'bg-brass-400/20',
}

export const BIOME_BORDER: Record<string, string> = {
  [ZONE_TYPES.WATER]: 'border-ocean-300/50',
  [ZONE_TYPES.BEACH]: 'border-parchment-300/60',
  [ZONE_TYPES.LAND]: 'border-brass-400/45',
}
