import { CHARGE_TICK, KEYWORDS, VEHICLE_TYPES } from '@shared/gameSettings'
import {
  chargeGateOf, chargeMaxOf, chargeRateOf, chargeRelayOf, dischargeCostOf, dischargeFromOf,
} from '@shared/engine/index'
import { HOVER_SPAWN_ALTITUDE_M } from '@shared/customBattle'

import blockerIcon from '../assets/icons/keywords/blocker.svg'
import temporaryIcon from '../assets/icons/keywords/temporary.svg'
import scrappyIcon from '../assets/icons/keywords/scrappy.svg'
import airScreenIcon from '../assets/icons/keywords/airScreen.svg'
import subScreenIcon from '../assets/icons/keywords/subScreen.svg'
import inoffensiveIcon from '../assets/icons/keywords/inoffensive.svg'
import halfCostIcon from '../assets/icons/keywords/halfCost.svg'
import fragileIcon from '../assets/icons/keywords/fragile.svg'
import stealthyIcon from '../assets/icons/keywords/stealthy.svg'
import mobileIcon from '../assets/icons/keywords/mobile.svg'
import roboticIcon from '../assets/icons/keywords/robotic.svg'
import upkeepIcon from '../assets/icons/keywords/upkeepRequired.svg'
import swiftIcon from '../assets/icons/keywords/swift.svg'
import decoyIcon from '../assets/icons/keywords/decoy.svg'
import chargeIcon from '../assets/icons/keywords/charge.svg'
import chargeRelayIcon from '../assets/icons/keywords/chargeRelay.svg'
import drainIcon from '../assets/icons/keywords/drain.svg'
import dischargeIcon from '../assets/icons/keywords/discharge.svg'
import dischargeFromIcon from '../assets/icons/keywords/dischargeFrom.svg'
import shipIcon from '../assets/icons/vehicles/ship.svg'
import planeIcon from '../assets/icons/vehicles/plane.svg'
import subIcon from '../assets/icons/vehicles/submarine.svg'
import tankIcon from '../assets/icons/vehicles/tank.svg'
import airshipIcon from '../assets/icons/vehicles/airship.svg'
import anchorIcon from '../assets/icons/anchorSVG.svg'
import hovercraftIcon from '../assets/icons/hovercraftSVG.svg'

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
    icon: blockerIcon,
    description: 'While this sits in a zone, your opponent may not declare base attacks in that zone.',
  },
  [KEYWORDS.TEMPORARY]: {
    key: KEYWORDS.TEMPORARY,
    label: 'Temporary',
    icon: temporaryIcon,
    description: 'Removed from the board at the start of the next turn — yours or your opponent\u2019s.',
  },
  [KEYWORDS.SCRAPPY]: {
    key: KEYWORDS.SCRAPPY,
    label: 'Scrappy',
    icon: scrappyIcon,
    description: 'Repairing it after a battle costs no materials. Fragile overrides this.',
  },
  [KEYWORDS.AIR_SCREEN]: {
    key: KEYWORDS.AIR_SCREEN,
    label: 'Air Screen',
    icon: airScreenIcon,
    description: 'Your opponent may not play planes or airships into this vehicle\u2019s zone.',
  },
  [KEYWORDS.SUB_SCREEN]: {
    key: KEYWORDS.SUB_SCREEN,
    label: 'Sub Screen',
    icon: subScreenIcon,
    description: 'Your opponent may not play submarines into this vehicle\u2019s zone.',
  },
  [KEYWORDS.INOFFENSIVE]: {
    key: KEYWORDS.INOFFENSIVE,
    label: 'Inoffensive',
    icon: inoffensiveIcon,
    description: 'Cannot join an attacking fleet or a base attack. It can still defend.',
  },
  [KEYWORDS.HALF_COST]: {
    key: KEYWORDS.HALF_COST,
    label: 'Half-Cost',
    icon: halfCostIcon,
    description: 'Costs half of its printed material cost to play. That halved cost also drives its repair bill and the base damage it deals.',
  },
  [KEYWORDS.FRAGILE]: {
    key: KEYWORDS.FRAGILE,
    label: 'Fragile',
    icon: fragileIcon,
    description: 'Can never be repaired: if a battle leaves it below 90% HP it is destroyed outright, with no 80–90% repair window. Overrides Scrappy. Airships always have it.',
  },
  [KEYWORDS.STEALTHY]: {
    key: KEYWORDS.STEALTHY,
    label: 'Stealthy',
    icon: stealthyIcon,
    description: 'When your opponent declares a fleet attack that includes this vehicle, you may pull it back out of the defending selection.',
  },
  [KEYWORDS.MOBILE]: {
    key: KEYWORDS.MOBILE,
    label: 'Mobile',
    icon: mobileIcon,
    description: 'You may move it to another legal zone once per turn. The move is free and does not activate either zone.',
  },
  [KEYWORDS.ROBOTIC]: {
    key: KEYWORDS.ROBOTIC,
    label: 'Robotic',
    icon: roboticIcon,
    description: 'A battle-conduct rule for the spawn sheet: unlimited in-battle repair resources, but treat it as destroyed if any of its sub-objects are destroyed.',
  },
  [KEYWORDS.UPKEEP_REQUIRED]: {
    key: KEYWORDS.UPKEEP_REQUIRED,
    label: 'Upkeep Required',
    icon: upkeepIcon,
    description: 'At the start of each of your turns, this vehicle takes 15% of its material cost out of that turn’s income before you spend anything. A Half-Cost vehicle pays 15% of its halved cost. It costs nothing on the turn you deploy it, and nothing at all once it leaves the board.',
  },
  [KEYWORDS.SWIFT]: {
    key: KEYWORDS.SWIFT,
    label: 'Swift',
    icon: swiftIcon,
    description: 'May attack the enemy base on the turn it is played — the usual one-turn deploy delay does not apply. Blockers still stop it, and the zone still activates only once.',
  },
  [KEYWORDS.DECOY]: {
    key: KEYWORDS.DECOY,
    label: 'Decoy',
    icon: decoyIcon,
    description: 'Enemy card effects that could target this vehicle must target it instead of another vehicle in its zone. It only redirects: an effect this vehicle is not a legal target of is unaffected.',
  },
}

export const VEHICLE_TYPE_INFO: Record<string, Attribute> = {
  [VEHICLE_TYPES.SHIP]: {
    key: VEHICLE_TYPES.SHIP,
    label: 'Ship',
    icon: shipIcon,
    description: 'Deploys to water and beach zones.',
  },
  [VEHICLE_TYPES.HOVER]: {
    key: VEHICLE_TYPES.HOVER,
    label: 'Hovercraft',
    icon: hovercraftIcon,
    // 2026-09-22 hovercraft amendment §4. The height is DERIVED from the battle
    // file's constant, never restated (BattleOverlay's 80 → 160 lesson).
    description: `Counts as a ship for every rule, and deploys to water and beach zones. In FtD it spawns ${HOVER_SPAWN_ALTITUDE_M} m above the water, where it hovers.`,
  },
  [VEHICLE_TYPES.SUB]: {
    key: VEHICLE_TYPES.SUB,
    label: 'Submarine',
    icon: subIcon,
    // Wave 7 narrowed this from "can never damage an enemy base": TG Vengeful
    // is a submarine whose card text deals base damage. The rule it was
    // describing is the BOMBARDMENT roster (baseStrikersIn, reached only from
    // ATTACK_ENEMY_BASE), not card-forced damage — so the wording now says
    // what the engine actually enforces, and no printed rule contradicts a
    // shipped card (spec §7.3, ruling E-3).
    description: 'Deploys to water and beach zones, and can never bombard an enemy base — though a card effect may still damage one. Blocked by an enemy Sub Screen. A deck may hold at most 6 submarines.',
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

/**
 * The small icon for a vehicle type (board chip, details list); unknown types
 * get the generic anchor. A card's picture is not this: see cardImageOrFallback.
 */
export function vehicleTypeIcon(vehicleType: string | null): string {
  return VEHICLE_TYPE_INFO[vehicleType ?? '']?.icon ?? anchorIcon
}

// 2026-09-21 LH Charge (spec §3.1–§3.3; Drain since 2026-09-22). Charge is not
// a keyword — it lives in a card’s meta — so these rows are built per card
// rather than looked up, and they are the only place the rules are written
// down for a player. The two worth being pedantic about are the ones the
// shapes read alike but split differently: a Drain comes out of ANY MIX of
// hulls across the whole board, while every Discharge comes out of ONE hull
// that must hold the entire cost.
//
// Read through the engine’s own accessors, never by re-parsing meta, so the
// printed number can never drift from the number the rules enforce.
export function chargeAttributesOf(meta: Record<string, unknown>): Attribute[] {
  const card = { meta }
  const rows: Attribute[] = []

  const max = chargeMaxOf(card)
  if (max > 0) {
    // chargeRateOf defaults to CHARGE_TICK for every card, so it is only
    // meaningful once we know the hull actually stores charge.
    const rate = chargeRateOf(card)
    rows.push({
      key: 'charge', label: `Charge ${max}`, icon: chargeIcon,
      description:
        `Stores up to ${max} charge. It gains ${rate} charge at the start of each of your turns`
        + `${rate === CHARGE_TICK ? ', ' : ` — faster than the usual ${CHARGE_TICK} — `}up to that cap. `
        + 'Charge sits on this vehicle alone: there is no shared pool, and it carries over between turns '
        + 'until something spends it.',
    })
  }

  const relay = chargeRelayOf(card)
  if (relay > 0) {
    rows.push({
      key: 'chargeRelay', label: `Charge Relay ${relay}`, icon: chargeRelayIcon,
      description:
        `At the start of your turn, every other friendly vehicle in this zone gains ${relay} charge on top `
        + 'of its own. Relays do not stack — a second one in the same zone adds nothing — and a relay '
        + 'never charges itself or another relay.',
    })
  }

  const gate = chargeGateOf(card)
  if (gate > 0) {
    rows.push({
      key: 'requiresCharge', label: `Drain ${gate} Charge`, icon: drainIcon,
      description:
        `Playing this drains ${gate} charge from the LH vehicles you control. Take it from any of them, `
        + 'in any zone — you choose how much each gives up as you play it. You need '
        + `${gate} in total across your whole board, so losing charged vehicles can put this card out of reach.`,
    })
  }

  const discharge = dischargeCostOf(card)
  if (discharge !== null) {
    rows.push({
      key: 'discharge', label: `Discharge ${discharge}`, icon: dischargeIcon,
      description:
        `Using its ability spends ${discharge} charge from this vehicle alone — charge held by your other `
        + 'vehicles cannot help pay, however much of it you have. It also spends this vehicle’s '
        + 'activation for the turn.',
    })
  }

  const from = dischargeFromOf(card)
  if (from !== null) {
    rows.push({
      key: 'dischargeFrom', label: `Discharge ${from} from a friendly LH vehicle`, icon: dischargeFromIcon,
      description:
        `Playing this spends ${from} charge from one friendly LH vehicle you choose. That single vehicle `
        + `must hold all ${from} — you cannot split the cost across several — and it spends its `
        + 'activation for the turn as well.',
    })
  }

  return rows
}

/**
 * The attributes to explain for one card: its vehicle type (if any) first,
 * then its charge rules (if any), then one entry per keyword. A keyword with
 * no glossary entry still gets a row, so a card can never carry a silently-
 * unexplained modifier.
 */
export function attributesOf(
  vehicleType: string | null,
  keywords: string[],
  meta: Record<string, unknown> = {},
): Attribute[] {
  const typeInfo = vehicleType !== null ? VEHICLE_TYPE_INFO[vehicleType] : undefined
  return [
    ...(typeInfo ? [typeInfo] : []),
    ...chargeAttributesOf(meta),
    ...keywords.map(
      (k) =>
        KEYWORD_INFO[k] ?? {
          key: k, label: k, icon: anchorIcon,
          description: 'No description for this modifier yet.',
        },
    ),
  ]
}
