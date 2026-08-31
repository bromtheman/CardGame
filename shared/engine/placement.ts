import { ADDITIONAL_SPAWNS_CAP, KEYWORDS, VEHICLE_TYPES, ZONE_TYPES } from '../gameSettings.ts'
import type { CardInstance, PublicGameState } from './gameInit.ts'
import type { ApplyResult, EngineContext, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import {
  copyMeta, discardCard, err, findVehicle, otherSide, registerHandler, zoneById,
} from './gameEngine.ts'
import { costModifierFor, effectFor, effectName, noteUnimplemented } from '../effects/registry.ts'

const BIOMES_BY_TYPE: Record<string, string[]> = {
  [VEHICLE_TYPES.SHIP]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH],
  [VEHICLE_TYPES.SUB]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH],
  [VEHICLE_TYPES.TANK]: [ZONE_TYPES.BEACH, ZONE_TYPES.LAND],
  [VEHICLE_TYPES.PLANE]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH, ZONE_TYPES.LAND],
  [VEHICLE_TYPES.AIRSHIP]: [ZONE_TYPES.WATER, ZONE_TYPES.BEACH, ZONE_TYPES.LAND],
}

export function biomeAllows(vehicleType: string | null, biome: string): boolean {
  return vehicleType !== null && (BIOMES_BY_TYPE[vehicleType] ?? []).includes(biome)
}

function screenBlocks(state: PublicGameState, side: Side, zoneId: number, vehicleType: string): boolean {
  const zone = state.zones.find((z) => z.id === zoneId)
  if (!zone) return true
  const enemy = zone.cards[otherSide(side)]
  const isAir = vehicleType === VEHICLE_TYPES.PLANE || vehicleType === VEHICLE_TYPES.AIRSHIP
  if (isAir && enemy.some((c) => c.keywords.includes(KEYWORDS.AIR_SCREEN))) return true
  if (vehicleType === VEHICLE_TYPES.SUB && enemy.some((c) => c.keywords.includes(KEYWORDS.SUB_SCREEN))) return true
  return false
}

// A zone rider that forbids this side from PLAYING a card of some faction
// there (Sub Killer, spec §4.3 "DP5 as wave 5 built it"). Read off
// `data.blocksFaction` rather than off the rider's effect name, so the rule
// lives here and the next blocking card needs no engine edit — the same
// reasoning that made `defensiveOmission` a data key (spec §4.8).
//
// Deliberately only a PLAY restriction: MOVE_VEHICLE and the hero-power
// relocation go through biomeAllows directly, and a spawn bypasses placement
// legality entirely (spec §7.4). Sub Killer's text says "play".
function riderBlocks(state: PublicGameState, side: Side, zoneId: number, faction: string): boolean {
  return state.zoneEffects.some(
    (e) => e.zoneId === zoneId && e.side === side && e.data?.blocksFaction === faction,
  )
}

export function legalZonesFor(state: PublicGameState, side: Side, card: CardInstance): number[] {
  if (card.type !== 'vehicle' || card.vehicleType === null) return []
  return state.zones
    .filter((z) => (
      biomeAllows(card.vehicleType, z.biome) &&
      !screenBlocks(state, side, z.id, card.vehicleType!) &&
      !riderBlocks(state, side, z.id, card.faction)
    ))
    .map((z) => z.id)
}

// Spec §3.7 Half-Cost: the discount is applied at usage time, never baked
// into stored material_cost (seed data and create-card both store full cost).
export function effectiveMaterialCostOf(card: { materialCost: number; keywords: string[] }): number {
  return card.keywords.includes(KEYWORDS.HALF_COST)
    ? Math.floor(card.materialCost / 2)
    : card.materialCost
}

export function canAfford(state: PublicGameState, side: Side, card: CardInstance): boolean {
  return (
    state.resources[side].materials >= effectiveMaterialCostOf(card) &&
    state.resources[side].cp >= card.cpCost
  )
}

// Spec §4.6 and its two wave-6 departures ("4.6 as wave 6 extended it").
// Exactly ONE comparator is present per card, preserving each card's own
// wording: "more than" (PredatorX, Chrysaor), "or more" (Orbit), "less than"
// (Paladin).
interface ResourceSurge {
  materialsOver?: number
  materialsAtLeast?: number
  materialsUnder?: number
  extraSpawns?: number
  // Departure 1 — Chrysaor: "this card costs 100k more". A purchase-price
  // mechanic like every other, so it never reaches effectiveMaterialCostOf.
  costDelta?: number
  // Departure 2 — Paladin: "can be played with halfcost and temporary". These
  // land on the HULL, not only on the price: endTurn's cull reads `temporary`
  // off the board, so a hull that got it at price time would never despawn.
  grantKeywords?: string[]
}

const surgeOf = (card: CardInstance): ResourceSurge | null => {
  const raw = card.meta.resourceSurge
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ResourceSurge) : null
}

// The shared condition §4.6 predicted by name. Read BEFORE payment at every
// call site — pay() moves the materials the condition reads, and Chrysaor's
// surged price is exactly its own threshold, so a post-payment re-read would
// flip its condition off between pricing and spawning.
export function resourceSurgeActive(state: PublicGameState, side: Side, card: CardInstance): boolean {
  const surge = surgeOf(card)
  if (!surge) return false
  const materials = state.resources[side].materials
  if (typeof surge.materialsOver === 'number') return materials > surge.materialsOver
  if (typeof surge.materialsAtLeast === 'number') return materials >= surge.materialsAtLeast
  if (typeof surge.materialsUnder === 'number') return materials < surge.materialsUnder
  return false
}

// Plain card data, so it is safe to read once the boolean above has been
// captured — which is what lets deployVehicle take the flag rather than
// re-deriving the condition after payment.
function grantedKeywordsOf(card: CardInstance): string[] {
  const raw = surgeOf(card)?.grantKeywords
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
}

// Merge, idempotently — a keyword the card already prints is not duplicated.
function withGranted(keywords: string[], granted: string[]): string[] {
  if (granted.length === 0) return keywords
  return [...keywords, ...granted.filter((k) => !keywords.includes(k))]
}

// Ruling B-9: a surge with no keyword grant of its own is a Half-Cost
// SUPPRESSION (§4.6's original shape — PredatorX and Orbit); one that grants
// keywords adds them instead. One rule, two arms, which is what keeps the two
// older cards byte-for-byte unchanged.
export function halfCostSuppressed(state: PublicGameState, side: Side, card: CardInstance): boolean {
  if (!resourceSurgeActive(state, side, card)) return false
  return grantedKeywordsOf(card).length === 0
}

export function surgeSpawnsFor(card: CardInstance): number {
  return Math.max(0, Math.floor(Number(surgeOf(card)?.extraSpawns) || 0))
}

function surgeCostDeltaFor(state: PublicGameState, side: Side, card: CardInstance): number {
  if (!resourceSurgeActive(state, side, card)) return 0
  const delta = surgeOf(card)?.costDelta
  return typeof delta === 'number' && Number.isFinite(delta) ? delta : 0
}

// Play-time cost: (base + registered modifier + stored costDelta), Half-Cost
// halving, clamp ≥ 0. Base damage, repairs, and in-battle resources keep
// using effectiveMaterialCostOf — these are play-time-only mechanics.
export function effectiveCostInGame(state: PublicGameState, side: Side, card: CardInstance): number {
  const name = effectName(card, 'costModifier')
  const fn = name !== null ? costModifierFor(name) : null
  const stored = typeof card.meta.costDelta === 'number' ? card.meta.costDelta : 0
  const delta = stored + surgeCostDeltaFor(state, side, card)
  const modified = card.materialCost + (fn ? fn(state, side, card) : 0) + delta
  // The two arms of ruling B-9: a suppressing surge strips Half-Cost, a
  // granting one adds whatever it grants (which for Paladin includes
  // Half-Cost). The granted list is the SAME one deployVehicle stamps onto
  // the hull, so the price and the board never disagree.
  const keywords = halfCostSuppressed(state, side, card)
    ? card.keywords.filter((k) => k !== KEYWORDS.HALF_COST)
    : withGranted(card.keywords, resourceSurgeActive(state, side, card) ? grantedKeywordsOf(card) : [])
  return Math.max(0, effectiveMaterialCostOf({ materialCost: modified, keywords }))
}

function canAffordInGame(game: EngineGame, side: Side, card: CardInstance): boolean {
  return (
    game.state.resources[side].materials >= effectiveCostInGame(game.state, side, card) &&
    game.state.resources[side].cp >= card.cpCost
  )
}

function takeFromHand(game: EngineGame, side: Side, instanceId: string): CardInstance | null {
  const hand = game.privates[side].hand
  const index = hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return null
  const [card] = hand.splice(index, 1)
  game.state.counts[side].hand = hand.length
  return card
}

// An ability card is spent once it resolves: it leaves play into its owner's
// discard (state.destroyed), which drawCard reshuffles when the deck runs
// out. Call this AFTER effects resolve — a card that draws from an empty deck
// must not be able to shuffle itself back in mid-resolution.
export function spendCard(game: EngineGame, side: Side, card: CardInstance): void {
  discardCard(game, side, card)
}

function pay(game: EngineGame, side: Side, card: CardInstance): void {
  game.state.resources[side].materials -= effectiveCostInGame(game.state, side, card)
  game.state.resources[side].cp -= card.cpCost
}

// Runs a played card's triggers (in the order given by `keys`), then notes
// any unimplemented meta effects. Returns an error result if an implemented
// effect reports failure (the caller returns this immediately — since
// applyAction works on a structuredClone of the input, nothing taken/paid
// up to this point sticks), or null on success. Reused by every play-style
// handler — each passes the trigger keys relevant to its own target shape
// (spawnBuccaneerEffect/onPlayEffect for zone plays, playOnVehicleEffect/
// playOnCardEffect for Task 5's targeting actions, doubleUpEffect, …).
function resolvePlayEffects(
  game: EngineGame, actor: Side, card: CardInstance, ctx: EngineContext,
  targets: { targetZoneId?: number; targetInstanceId?: string; placedInstanceIds?: string[] },
  keys: string[],
): ApplyResult | null {
  for (const key of keys) {
    const name = effectName(card, key)
    if (name === null) continue
    const fn = effectFor(name)
    if (fn && !fn({ game, actor, card, ctx, ...targets })) {
      return err(400, `${card.name}'s effect could not resolve — check its target`)
    }
  }
  noteUnimplemented(game, card)
  return null
}

// Extracted from PLAY_CARD_TO_ZONE's vehicle branch so PLAY_CARD_TARGETING_
// CARD_IN_HAND can deploy a vehicle too (spec §4.3 DP6). Places the card
// itself, then additionalSpawns (spec §3.9) + resourceSurge (spec §4.6)
// copies on top, capped at ADDITIONAL_SPAWNS_CAP. Callers must read `surged`
// BEFORE pay() reduces materials — see their own comments for why. Returns
// every instanceId placed (card + copies), for placedInstanceIds.
function deployVehicle(
  game: EngineGame, ctx: EngineContext, actor: Side,
  card: CardInstance, zoneId: number, surged: boolean,
): string[] {
  const placedInstanceIds: string[] = []
  const zone = game.state.zones.find((z) => z.id === zoneId)!
  // A granting surge stamps its keywords onto the hull that lands, not only
  // onto the price (spec §4.6, departure 2 — Paladin). Derived from `surged`,
  // which the caller captured BEFORE pay(), rather than re-read here.
  const granted = surged ? grantedKeywordsOf(card) : []
  const keywords = withGranted(card.keywords, granted)
  const entry: ZoneCardEntry = {
    ...card, keywords, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
  zone.cards[actor].push(entry)
  placedInstanceIds.push(entry.instanceId)
  // additionalSpawns: one payment lands N+1 hulls (spec §3.9). resourceSurge
  // (spec §4.6) adds more on top, but only when the surge condition held.
  const printed = Math.max(0, Math.floor(Number(card.meta.additionalSpawns) || 0))
  const extra = Math.min(printed + (surged ? surgeSpawnsFor(card) : 0), ADDITIONAL_SPAWNS_CAP)
  for (let i = 0; i < extra; i++) {
    const copy: ZoneCardEntry = {
      ...card, instanceId: ctx.newId(), meta: copyMeta(card.meta), keywords: [...keywords],
      playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
    }
    zone.cards[actor].push(copy)
    placedInstanceIds.push(copy.instanceId)
  }
  return placedInstanceIds
}

registerHandler('PLAY_CARD_TO_ZONE', (game, actor, action, ctx) => {
  if (action.type !== 'PLAY_CARD_TO_ZONE') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')

  // Vehicles deploy to a zone as usual. Abilities may only target a zone
  // when they carry a playOnZoneEffect trigger (e.g. Ambush, Spawn Buccaneer)
  // — anything else without a zone effect has no business here.
  const zoneEffectName = effectName(card, 'playOnZoneEffect')
  if (card.type !== 'vehicle' && zoneEffectName === null) {
    return err(400, 'Ability cards are played without a zone')
  }
  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')
  if (card.type === 'vehicle' && !legalZonesFor(game.state, actor, card).includes(action.zoneId)) {
    return err(400, 'That vehicle cannot deploy to that zone')
  }
  if (card.type !== 'vehicle' && !zoneById(game.state, action.zoneId)) {
    return err(400, 'No such zone')
  }

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  // Read the surge before paying — pay() reduces materials, which would flip
  // the condition off before the spawn count is decided. Chrysaor is the card
  // that would expose a regression: its surged price is exactly its own
  // threshold, so paying for itself turns its own condition off.
  //
  // resourceSurgeActive, not halfCostSuppressed: a GRANTING surge (Paladin)
  // suppresses nothing, so the narrower flag would silently skip both its
  // keyword stamp and its extra hulls.
  const surged = resourceSurgeActive(game.state, actor, card)

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  const placedInstanceIds = card.type === 'vehicle'
    ? deployVehicle(game, ctx, actor, card, action.zoneId, surged)
    : []

  const failure = resolvePlayEffects(
    game, actor, card, ctx,
    { targetZoneId: action.zoneId, placedInstanceIds },
    ['playOnZoneEffect', 'onPlayEffect'],
  )
  if (failure) return failure
  if (card.type !== 'vehicle') spendCard(game, actor, card)

  game.state.log.push(
    card.type === 'vehicle' ? `${card.name} deployed to zone ${action.zoneId}` : `${card.name} resolved`,
  )
  return { ok: true, game }
})

registerHandler('PLAY_ABILITY_CARD', (game, actor, action, ctx) => {
  if (action.type !== 'PLAY_ABILITY_CARD') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'ability') return err(400, 'Vehicles must target a zone')

  // Any card needing a zone/vehicle/card target — implemented or not — must
  // go through its own targeting action instead (two of three arrive in Task 5).
  const needsTarget = (['playOnZoneEffect', 'playOnVehicleEffect', 'playOnCardEffect'] as const)
    .some((key) => effectName(card, key) !== null)
  if (needsTarget) return err(400, `${card.name} needs a target`)

  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  // 'playOnZoneEffect' is deliberately excluded: needsTarget above already
  // rejects any card carrying that key, so only onPlayEffect can ever fire here.
  const failure = resolvePlayEffects(game, actor, card, ctx, {}, ['onPlayEffect'])
  if (failure) return failure
  spendCard(game, actor, card)

  game.state.log.push(`${card.name} resolved`)
  return { ok: true, game }
})

registerHandler('PLAY_CARD_TARGETING_CARD_ON_FIELD', (game, actor, action, ctx) => {
  if (action.type !== 'PLAY_CARD_TARGETING_CARD_ON_FIELD') return err(400, 'Bad action')
  if (typeof action.targetInstanceId !== 'string') return err(400, 'A target is required')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'ability') return err(400, 'Vehicles must target a zone')

  const effectMeta = effectName(card, 'playOnVehicleEffect')
  if (effectMeta === null) return err(400, `${card.name} does not target a vehicle`)
  if (!findVehicle(game.state, action.targetInstanceId)) return err(400, 'That target is not on the field')

  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  const failure = resolvePlayEffects(
    game, actor, card, ctx, { targetInstanceId: action.targetInstanceId }, ['playOnVehicleEffect', 'onPlayEffect'],
  )
  if (failure) return failure
  spendCard(game, actor, card)

  game.state.log.push(`${card.name} resolved`)
  return { ok: true, game }
})

registerHandler('SET_ALERT_CARD', (game, actor, action) => {
  if (action.type !== 'SET_ALERT_CARD') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'ability') return err(400, 'Only ability cards can be revealed as an alert')

  // Single global slot: your own alert may be re-revealed (replacing it),
  // but the opponent's live alert blocks a new reveal until it resolves.
  const existing = game.state.alertCard
  if (existing && existing.side !== actor) return err(409, 'An alert card is already revealed')

  game.state.alertCard = {
    side: actor, instanceId: action.instanceId, name: card.name, setOnTurn: game.turnNumber,
  }
  game.state.log.push(`Player ${actor.toUpperCase()} reveals ${card.name} — effect in progress`)
  return { ok: true, game }
})

registerHandler('PLAY_CARD_TARGETING_CARD_IN_HAND', (game, actor, action, ctx) => {
  if (action.type !== 'PLAY_CARD_TARGETING_CARD_IN_HAND') return err(400, 'Bad action')
  if (typeof action.targetInstanceId !== 'string') return err(400, 'A target is required')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')

  const effectMeta = effectName(card, 'playOnCardEffect')
  if (effectMeta === null) return err(400, `${card.name} does not target a card in hand`)
  // Handler-level check covers shape (own hand, not self) — the effect
  // itself re-validates the specifics it cares about (type, faction, cost).
  if (action.targetInstanceId === action.instanceId) return err(400, 'That card cannot target itself')
  if (!game.privates[actor].hand.some((c) => c.instanceId === action.targetInstanceId)) {
    return err(400, 'That target is not in your hand')
  }

  // A vehicle also needs a legal zone to deploy into (spec §4.3 DP6) — same
  // gate PLAY_CARD_TO_ZONE uses. An ability ignores zoneId entirely, stray
  // or not, exactly as before.
  if (
    card.type === 'vehicle'
    && (typeof action.zoneId !== 'number' || !legalZonesFor(game.state, actor, card).includes(action.zoneId))
  ) {
    return err(400, 'That vehicle cannot deploy to that zone')
  }

  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  // Read the surge before paying — same ordering PLAY_CARD_TO_ZONE relies on,
  // and the same broader flag: see its comment for why halfCostSuppressed is
  // the wrong one to capture here.
  const surged = resourceSurgeActive(game.state, actor, card)

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  // A vehicle deploys like any other hull; an ability places nothing on the
  // board.
  const placedInstanceIds = card.type === 'vehicle'
    ? deployVehicle(game, ctx, actor, card, action.zoneId as number, surged)
    : []

  const failure = resolvePlayEffects(
    game, actor, card, ctx,
    { targetInstanceId: action.targetInstanceId, placedInstanceIds },
    ['playOnCardEffect', 'onPlayEffect'],
  )
  if (failure) return failure
  // A vehicle is a hull that stays on the board — not spendCard'd. Only
  // abilities are spent on resolution (spec §4.3 DP6).
  if (card.type !== 'vehicle') spendCard(game, actor, card)

  // Never log the hand target's name — state.log is public to both players.
  game.state.log.push(
    card.type === 'vehicle' ? `${card.name} deployed to zone ${action.zoneId}` : `${card.name} resolved`,
  )
  return { ok: true, game }
})
