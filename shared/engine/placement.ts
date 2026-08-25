import { KEYWORDS, VEHICLE_TYPES, ZONE_TYPES } from '../gameSettings.ts'
import type { CardInstance, PublicGameState } from './gameInit.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { err, otherSide, registerHandler } from './gameEngine.ts'

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

function takeFromHand(game: EngineGame, side: Side, instanceId: string): CardInstance | null {
  const hand = game.privates[side].hand
  const index = hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return null
  const [card] = hand.splice(index, 1)
  game.state.counts[side].hand = hand.length
  return card
}

function pay(game: EngineGame, side: Side, card: CardInstance): void {
  game.state.resources[side].materials -= effectiveMaterialCostOf(card)
  game.state.resources[side].cp -= card.cpCost
}

registerHandler('PLAY_CARD_TO_ZONE', (game, actor, action) => {
  if (action.type !== 'PLAY_CARD_TO_ZONE') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'vehicle') return err(400, 'Ability cards are played without a zone')
  if (!canAfford(game.state, actor, card)) return err(400, 'You cannot afford that card')
  if (!legalZonesFor(game.state, actor, card).includes(action.zoneId)) {
    return err(400, 'That vehicle cannot deploy to that zone')
  }
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
  const entry: ZoneCardEntry = { ...card, playedOnTurn: game.turnNumber, movedOnTurn: null }
  game.state.zones.find((z) => z.id === action.zoneId)!.cards[actor].push(entry)
  game.state.log.push(`${card.name} deployed to zone ${action.zoneId}`)
  return { ok: true, game }
})

registerHandler('PLAY_ABILITY_CARD', (game, actor, action) => {
  if (action.type !== 'PLAY_ABILITY_CARD') return err(400, 'Bad action')
  const card = game.privates[actor].hand.find((c) => c.instanceId === action.instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.type !== 'ability') return err(400, 'Vehicles must target a zone')
  if (!canAfford(game.state, actor, card)) return err(400, 'You cannot afford that card')
  takeFromHand(game, actor, action.instanceId)
  pay(game, actor, card)
  game.state.log.push(`${card.name} resolved (no effect yet — effects arrive in Phase 5)`)
  return { ok: true, game }
})
