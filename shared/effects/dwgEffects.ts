import { DOUBLE_UP_MAX_COST, KEYWORDS, MARAUDER_DISCOUNT, RESERVES_CARD_COUNT } from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { drawCard, zoneById } from '../engine/gameEngine.ts'
import { effectiveMaterialCostOf } from '../engine/placement.ts'
import { grant, takeFromEnemyDeck } from './primitives.ts'
import { registerCostModifier, registerEffect } from './registry.ts'
import type { EffectPayload } from './registry.ts'

// draw a card and gain 1 CP (Crossbones)
const drawPlusCp = ({ game, actor, ctx }: EffectPayload): boolean => {
  drawCard(game, actor, ctx)
  game.state.resources[actor].cp += 1
  return true
}
registerEffect('crossbonesOnPlay', drawPlusCp)

// "When this vehicle is played, draw a vehicle card from the enemy deck
// reduce its cost by 50k." The ported implementation aliased this to
// Crossbones' own-deck draw plus 1 CP; card text is authoritative
// (spec 2 §6), so that ruling is superseded.
registerEffect('marauderOnPlay', ({ game, actor, ctx }) => {
  const before = game.privates[actor].hand.length
  takeFromEnemyDeck(game, actor, ctx, (c) => c.type === 'vehicle')
  const taken = game.privates[actor].hand[before]
  if (!taken) return true
  const current = typeof taken.meta.costDelta === 'number' ? taken.meta.costDelta : 0
  taken.meta = { ...taken.meta, costDelta: current - MARAUDER_DISCOUNT }
  return true
})

registerEffect('ransackOnPlay', grant({ draw: 1, cp: 1 }))
registerEffect('paddlegunEffect', grant({ draw: 1, from: 'enemy' }))

// cost -20k per friendly DWG vehicle on the field (Plunderer)
registerCostModifier('plundererCostModifier', (state, side) => {
  let count = 0
  for (const zone of state.zones) {
    count += zone.cards[side].filter((c) => c.type === 'vehicle' && c.faction === 'DWG').length
  }
  return count * -20_000
})

// shuffle a 0-cost copy into its owner's deck (Loggerhead, on death)
registerEffect('loggerheadOnDeath', ({ game, actor, card, ctx }) => {
  const deck = game.privates[actor].deck
  // card arrives as a ZoneCardEntry at death — strip the zone stamps so the
  // deck copy is a clean CardInstance
  const { playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = card as ZoneCardEntry
  deck.push({ ...snapshot, instanceId: ctx.newId(), materialCost: 0 })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  game.state.counts[actor].deck = deck.length
  game.state.log.push(`${card.name} leaves a free copy in the deck`)
  return true
})

// add RESERVES_CARD_COUNT distinct random built-in DWG vehicles to hand
// (Reserves — old BE shuffles the pool and shifts, so picks never repeat)
registerEffect('reservesEffect', ({ game, actor, ctx }) => {
  const pool = ctx.catalog.filter((c) => c.isBuiltIn && c.faction === 'DWG' && c.type === 'vehicle')
  if (pool.length === 0) return false
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  for (const pick of pool.slice(0, RESERVES_CARD_COUNT)) {
    game.privates[actor].hand.push({ ...pick, instanceId: ctx.newId() })
  }
  game.state.counts[actor].hand = game.privates[actor].hand.length
  return true
}, { needsCatalog: true })

// spawn a Scrappy, non-Temporary Buccaneer into the target zone (Spawn Buccaneer)
registerEffect('spawnBuccaneerEffect', ({ game, actor, ctx, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  const buccaneer = ctx.catalog.find((c) => c.isBuiltIn && c.name === 'Buccaneer')
  if (!zone || !buccaneer) return false
  const entry: ZoneCardEntry = {
    ...buccaneer, instanceId: ctx.newId(), keywords: [KEYWORDS.SCRAPPY],
    playedOnTurn: game.turnNumber, movedOnTurn: null,
  }
  zone.cards[actor].push(entry)
  game.state.log.push(`A Buccaneer joins zone ${zone.id} (Scrappy)`)
  return true
}, { needsCatalog: true })

// target DWG vehicle card in hand spawns an extra copy when played (Double Up)
registerEffect('doubleUpEffect', ({ game, actor, card, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string' || targetInstanceId === card.instanceId) return false
  const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
  if (!target || target.type !== 'vehicle' || target.faction !== 'DWG') return false
  if (effectiveMaterialCostOf(target) > DOUBLE_UP_MAX_COST) return false
  const current = typeof target.meta.additionalSpawns === 'number' ? target.meta.additionalSpawns : 0
  target.meta = { ...target.meta, additionalSpawns: current + 1 }
  return true
})

const DWG_WATERS_EFFECT = 'dwgWatersEffect'

// claim a zone as DWG Waters for the rest of the game (DWG Waters).
// Phase 1: the marker itself — persistent state plus the board badge. The
// battle-time riders in the card text (a guest DWG vehicle under 60k joining
// your defensive battles there, and gating direct base attacks behind it)
// need a battle-declare dispatch point that does not exist yet.
registerEffect('dwgWatersEffect', ({ game, actor, card, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  if (!zone) return false
  // Re-claiming a zone you already hold would buy nothing — reject before the
  // handler commits, so the materials are not spent on a no-op.
  const held = game.state.zoneEffects.some(
    (e) => e.effect === DWG_WATERS_EFFECT && e.zoneId === targetZoneId && e.side === actor,
  )
  if (held) return false
  game.state.zoneEffects.push({
    effect: DWG_WATERS_EFFECT, zoneId: targetZoneId, side: actor,
    cardName: card.name, setOnTurn: game.turnNumber,
  })
  game.state.log.push(
    `Zone ${targetZoneId} becomes DWG Waters for player ${actor.toUpperCase()} — for the rest of the game`,
  )
  return true
})
