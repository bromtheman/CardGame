import type { Side } from '@shared/engine/engineTypes'
import type { ZoneEffect } from '@shared/engine/gameInit'

export type ZoneEffectIcon = 'anchor' | 'crosshair' | 'torpedo' | 'noSubs' | 'ghostShip' | 'shield'

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
  // Wave 5's riders. Ambush's badge is not decoration: "deploy after the
  // defending player" is a rule the DEFENDER has to follow in From The
  // Depths, so both players must be able to see it before the fight.
  ambushEffect: {
    icon: 'crosshair',
    label: 'Ambush',
    text: 'This turn, their next attack here deploys last and starts 600m closer.',
  },
  ongoingAttritionEffect: {
    icon: 'torpedo',
    label: 'Ongoing Attrition',
    text: 'This turn, activating this zone while out-numbering also grinds the enemy base.',
  },
  subKillerEffect: {
    icon: 'noSubs',
    label: 'Sub Killer',
    text: 'This turn, they may not play a GT vehicle into this zone.',
  },
  recurringThreatEffect: {
    icon: 'ghostShip',
    label: 'Recurring Threat',
    text: 'A destroyed vehicle may be summoned back into their defensive battles here.',
  },
  // Wave 6. Not decoration: the marker is the only warning the other player
  // gets before deploying into a fleet battle they did not choose, and it is
  // permanent — so it must be visible for as long as it stands.
  blockadeEffect: {
    icon: 'shield',
    label: 'Blockade',
    text: 'Deploying a vehicle here starts a fleet battle while they hold this zone.',
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
  for (const [index, effect] of (zoneEffects ?? []).entries()) {
    if (effect.zoneId !== zoneId) continue
    const display = ZONE_EFFECT_DISPLAY[effect.effect]
    if (!display) continue
    badges.push({
      // The array index is in the key because effect+side+zone is NOT unique:
      // one side may plant several Recurring Threats on one zone, each
      // remembering a different hull, and two duplicate React keys would make
      // the second badge disappear.
      key: `${effect.effect}-${effect.side}-${effect.zoneId}-${index}`,
      icon: display.icon,
      label: display.label,
      detail: `Player ${effect.side.toUpperCase()} — ${display.text}`,
      mine: effect.side === mySide,
    })
  }
  return badges
}
