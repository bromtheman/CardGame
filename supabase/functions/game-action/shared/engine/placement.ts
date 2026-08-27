import { ADDITIONAL_SPAWNS_CAP, KEYWORDS, VEHICLE_TYPES, ZONE_TYPES } from '../gameSettings.ts'
import type { CardInstance, PublicGameState } from './gameInit.ts'
import type { ApplyResult, EngineContext, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { err, findVehicle, otherSide, registerHandler, zoneById } from './gameEngine.ts'
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

export function legalZonesFor(state: PublicGameState, side: Side, card: CardInstance): number[] {
  if (card.type !== 'vehicle' || card.vehicleType === null) return []
  return state.zones
    .filter((z) => biomeAllows(card.vehicleType, z.biome) && !screenBlocks(state, side, z.id, card.vehicleType!))
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

// Play-time cost: (base + registered modifier + stored costDelta), Half-Cost
// halving, clamp ≥ 0. Base damage, repairs, and in-battle resources keep
// using effectiveMaterialCostOf — these are play-time-only mechanics.
export function effectiveCostInGame(state: PublicGameState, side: Side, card: CardInstance): number {
  const name = effectName(card, 'costModifier')
  const fn = name !== null ? costModifierFor(name) : null
  const delta = typeof card.meta.costDelta === 'number' ? card.meta.costDelta : 0
  const modified = card.materialCost + (fn ? fn(state, side, card) : 0) + delta
  return Math.max(0, effectiveMaterialCostOf({ ...card, materialCost: modified }))
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
  const { instanceId: _instanceId, ...snapshot } = card
  game.state.destroyed[side].push(snapshot)
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

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  const placedInstanceIds: string[] = []
  if (card.type === 'vehicle') {
    const zone = game.state.zones.find((z) => z.id === action.zoneId)!
    const entry: ZoneCardEntry = { ...card, playedOnTurn: game.turnNumber, movedOnTurn: null }
    zone.cards[actor].push(entry)
    placedInstanceIds.push(entry.instanceId)
    // additionalSpawns: one payment lands N+1 hulls (spec §3.9).
    const extra = Math.min(Math.max(0, Math.floor(Number(card.meta.additionalSpawns) || 0)), ADDITIONAL_SPAWNS_CAP)
    for (let i = 0; i < extra; i++) {
      const copy: ZoneCardEntry = {
        ...card, instanceId: ctx.newId(), playedOnTurn: game.turnNumber, movedOnTurn: null,
      }
      zone.cards[actor].push(copy)
      placedInstanceIds.push(copy.instanceId)
    }
  }

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
  if (card.type !== 'ability') return err(400, 'Vehicles must target a zone')

  const effectMeta = effectName(card, 'playOnCardEffect')
  if (effectMeta === null) return err(400, `${card.name} does not target a card in hand`)
  // Handler-level check covers shape (own hand, not self) — the effect
  // itself re-validates the specifics it cares about (type, faction, cost).
  if (action.targetInstanceId === action.instanceId) return err(400, 'That card cannot target itself')
  if (!game.privates[actor].hand.some((c) => c.instanceId === action.targetInstanceId)) {
    return err(400, 'That target is not in your hand')
  }

  if (!canAffordInGame(game, actor, card)) return err(400, 'You cannot afford that card')

  if (game.state.alertCard?.instanceId === action.instanceId) game.state.alertCard = null

  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)

  const failure = resolvePlayEffects(
    game, actor, card, ctx, { targetInstanceId: action.targetInstanceId }, ['playOnCardEffect', 'onPlayEffect'],
  )
  if (failure) return failure
  spendCard(game, actor, card)

  game.state.log.push(`${card.name} resolved`)
  return { ok: true, game }
})
