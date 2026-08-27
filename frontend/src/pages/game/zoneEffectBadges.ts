import type { Side } from '@shared/engine/engineTypes'
import type { ZoneEffect } from '@shared/engine/gameInit'

export type ZoneEffectIcon = 'anchor'

export interface ZoneEffectBadge {
  key: string
  icon: ZoneEffectIcon
  label: string
  /** Tooltip text — who owns the marker and what it does. */
  detail: string
  mine: boolean
}

// Display metadata per persistent zone effect. A new persistent zone card
// adds one entry here (and its icon to BoardZone's ZONE_EFFECT_ICONS) to get
// a board badge; effect names with no entry render nothing.
const ZONE_EFFECT_DISPLAY: Record<string, { icon: ZoneEffectIcon; label: string; text: string }> = {
  dwgWatersEffect: {
    icon: 'anchor',
    label: 'DWG Waters',
    text: 'Claimed as DWG Waters for the rest of the game.',
  },
}

// Badges to draw on one zone panel. `zoneEffects` may be undefined on game
// rows written before the field existed (the engine's normalizeState repairs
// them server-side, but the client renders whatever it is handed).
export function zoneEffectBadges(
  zoneEffects: ZoneEffect[] | undefined,
  zoneId: number,
  mySide: Side,
): ZoneEffectBadge[] {
  const badges: ZoneEffectBadge[] = []
  for (const effect of zoneEffects ?? []) {
    if (effect.zoneId !== zoneId) continue
    const display = ZONE_EFFECT_DISPLAY[effect.effect]
    if (!display) continue
    badges.push({
      key: `${effect.effect}-${effect.side}-${effect.zoneId}`,
      icon: display.icon,
      label: display.label,
      detail: `Player ${effect.side.toUpperCase()} — ${display.text}`,
      mine: effect.side === mySide,
    })
  }
  return badges
}
