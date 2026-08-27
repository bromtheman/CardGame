import { KEYWORDS, VEHICLE_TYPES } from '@shared/gameSettings'

import shield from '../assets/icons/shieldSVG.svg'
import repair from '../assets/icons/repairSVG.svg'
import hourglass from '../assets/icons/hourglassSVG.svg'
import noFly from '../assets/icons/noFlyZoneSVG.svg'
import noSubs from '../assets/icons/noSubsSVG.svg'
import spark from '../assets/icons/sparkSVG.svg'
import tire from '../assets/icons/tireSVG.svg'
import tire2 from '../assets/icons/tire2SVG.svg'
import crosshair from '../assets/icons/crosshairSVG.svg'
import torpedo from '../assets/icons/torpedoSVG.svg'
import airport from '../assets/icons/airportSVG.svg'
import shipIcon from '../assets/icons/shipSVG.svg'
import planeIcon from '../assets/icons/planeSVG.svg'
import subIcon from '../assets/icons/submarineSVG.svg'
import tankIcon from '../assets/icons/tankSVG.svg'
import airshipIcon from '../assets/icons/airShield1SVG.svg'
import anchorIcon from '../assets/icons/anchorSVG.svg'

// Player-facing glossary — icon, label and plain-English rule for every
// keyword and vehicle type. The wording tracks spec §3.7 (keywords) and
// §3.2/§3.4 (placement + base attacks); change it here when a rule changes
// there. Frontend-only on purpose: this is UI copy, so it stays out of
// shared/ (and out of the functions:sync contract).

export interface Attribute {
  /** Stable key — a KEYWORDS value or a VEHICLE_TYPES value. */
  key: string
  label: string
  description: string
  icon: string
}

export const KEYWORD_INFO: Record<string, Attribute> = {
  [KEYWORDS.BLOCKER]: {
    key: KEYWORDS.BLOCKER,
    label: 'Blocker',
    icon: shield,
    description: 'While this sits in a zone, your opponent may not declare base attacks in that zone.',
  },
  [KEYWORDS.TEMPORARY]: {
    key: KEYWORDS.TEMPORARY,
    label: 'Temporary',
    icon: hourglass,
    description: 'Removed from the board at the start of the next turn — yours or your opponent\u2019s.',
  },
  [KEYWORDS.SCRAPPY]: {
    key: KEYWORDS.SCRAPPY,
    label: 'Scrappy',
    icon: repair,
    description: 'Repairing it after a battle costs no materials. Fragile overrides this.',
  },
  [KEYWORDS.AIR_SCREEN]: {
    key: KEYWORDS.AIR_SCREEN,
    label: 'Air Screen',
    icon: noFly,
    description: 'Your opponent may not play planes or airships into this vehicle\u2019s zone.',
  },
  [KEYWORDS.SUB_SCREEN]: {
    key: KEYWORDS.SUB_SCREEN,
    label: 'Sub Screen',
    icon: noSubs,
    description: 'Your opponent may not play submarines into this vehicle\u2019s zone.',
  },
  [KEYWORDS.INOFFENSIVE]: {
    key: KEYWORDS.INOFFENSIVE,
    label: 'Inoffensive',
    icon: airport,
    description: 'Cannot join an attacking fleet or a base attack. It can still defend.',
  },
  [KEYWORDS.HALF_COST]: {
    key: KEYWORDS.HALF_COST,
    label: 'Half-Cost',
    icon: spark,
    description: 'Costs half of its printed material cost to play. That halved cost also drives its repair bill and the base damage it deals.',
  },
  [KEYWORDS.FRAGILE]: {
    key: KEYWORDS.FRAGILE,
    label: 'Fragile',
    icon: torpedo,
    description: 'Can never be repaired: if a battle leaves it below 90% HP it is destroyed outright, with no 80–90% repair window. Overrides Scrappy. Airships always have it.',
  },
  [KEYWORDS.STEALTHY]: {
    key: KEYWORDS.STEALTHY,
    label: 'Stealthy',
    icon: crosshair,
    description: 'When your opponent declares a fleet attack that includes this vehicle, you may pull it back out of the defending selection.',
  },
  [KEYWORDS.MOBILE]: {
    key: KEYWORDS.MOBILE,
    label: 'Mobile',
    icon: tire,
    description: 'You may move it to another legal zone once per turn. The move is free and does not activate either zone.',
  },
  [KEYWORDS.ROBOTIC]: {
    key: KEYWORDS.ROBOTIC,
    label: 'Robotic',
    icon: tire2,
    description: 'A battle-conduct rule for the spawn sheet: unlimited in-battle repair resources, but treat it as destroyed if any of its sub-objects are destroyed.',
  },
}

export const VEHICLE_TYPE_INFO: Record<string, Attribute> = {
  [VEHICLE_TYPES.SHIP]: {
    key: VEHICLE_TYPES.SHIP,
    label: 'Ship',
    icon: shipIcon,
    description: 'Deploys to water and beach zones.',
  },
  [VEHICLE_TYPES.SUB]: {
    key: VEHICLE_TYPES.SUB,
    label: 'Submarine',
    icon: subIcon,
    description: 'Deploys to water and beach zones, and can never damage an enemy base. Blocked by an enemy Sub Screen. A deck may hold at most 6 submarines.',
  },
  [VEHICLE_TYPES.TANK]: {
    key: VEHICLE_TYPES.TANK,
    label: 'Tank',
    icon: tankIcon,
    description: 'Deploys to beach and land zones.',
  },
  [VEHICLE_TYPES.PLANE]: {
    key: VEHICLE_TYPES.PLANE,
    label: 'Plane',
    icon: planeIcon,
    description: 'Deploys to any zone, and is automatically Half-Cost and Temporary. Blocked by an enemy Air Screen. A deck may hold at most 6 planes and airships combined.',
  },
  [VEHICLE_TYPES.AIRSHIP]: {
    key: VEHICLE_TYPES.AIRSHIP,
    label: 'Airship',
    icon: airshipIcon,
    description: 'Deploys to any zone, and is automatically Fragile. Blocked by an enemy Air Screen. A deck may hold at most 6 planes and airships combined.',
  },
}

/** Human label for a keyword, falling back to the raw key for unknown ones. */
export function keywordLabel(keyword: string): string {
  return KEYWORD_INFO[keyword]?.label ?? keyword
}

/** Art for a keyword, or null when we have none — callers fall back to text. */
export function keywordIcon(keyword: string): string | null {
  return KEYWORD_INFO[keyword]?.icon ?? null
}

/** Art for a vehicle type; abilities and unknown types get the generic anchor. */
export function vehicleTypeIcon(vehicleType: string | null): string {
  return VEHICLE_TYPE_INFO[vehicleType ?? '']?.icon ?? anchorIcon
}

/**
 * The attributes to explain for one card: its vehicle type (if any) first,
 * then one entry per keyword. A keyword with no glossary entry still gets a
 * row, so a card can never carry a silently-unexplained modifier.
 */
export function attributesOf(vehicleType: string | null, keywords: string[]): Attribute[] {
  const typeInfo = vehicleType !== null ? VEHICLE_TYPE_INFO[vehicleType] : undefined
  return [
    ...(typeInfo ? [typeInfo] : []),
    ...keywords.map(
      (k) =>
        KEYWORD_INFO[k] ?? {
          key: k, label: k, icon: anchorIcon,
          description: 'No description for this modifier yet.',
        },
    ),
  ]
}
