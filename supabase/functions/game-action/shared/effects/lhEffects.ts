import { effectiveCostInGame } from '../engine/placement.ts'
import { KEYWORDS } from '../gameSettings.ts'
import { choice, drawFromPool, grant, sequence, spawnVehicles, whenPlayed, zoneOccupants } from './primitives.ts'
import type { EffectFn } from './registry.ts'
import { registerEffect } from './registry.ts'

// LH built-in card effects.
const tgRobotics = drawFromPool({ source: 'catalog', filter: { faction: 'TG' }, count: 1 })
registerEffect('ampereOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('candelaOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('quadrupoleOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('coulombEffect', grant({ draw: 1 }))

// "a player made ship or tank" — two pool draws behind one name, so
// PoolFilter does not need a multi-value vehicleType for a single card.
const drawCustomShip = drawFromPool({
  source: 'deck', filter: { isBuiltIn: false, vehicleType: 'ship' }, count: 1, allowEmpty: true,
})
const drawCustomTank = drawFromPool({
  source: 'deck', filter: { isBuiltIn: false, vehicleType: 'tank' }, count: 1, allowEmpty: true,
})
const conduitOnDeath: EffectFn = (payload) => {
  const before = payload.game.privates[payload.actor].hand.length
  drawCustomShip(payload)
  if (payload.game.privates[payload.actor].hand.length > before) return true
  return drawCustomTank(payload)
}
registerEffect('conduitEffect', conduitOnDeath)

// "When this vehicle is played into an empty zone, draw a card and refund
// its cost." Recomputing the cost is exact here: Sapphire carries no
// costModifier, so nothing about it depends on board state.
registerEffect('sapphireEffect', whenPlayed(
  (p) => zoneOccupants(p, 'either')?.length === 0,
  sequence(
    grant({ draw: 1 }),
    ({ game, actor, card }) => {
      game.state.resources[actor].materials += effectiveCostInGame(game.state, actor, card)
      game.state.log.push(`${card.name} slips in unopposed — its cost is refunded`)
      return true
    },
  ),
))

// Spec §7.2 authors this card's text: "Once per turn, you may pay 1cp to draw
// a random card from the [TG] Robotics pool." Same pool as Ampere's.
registerEffect('spectrumEffect', tgRobotics, { needsCatalog: true })

// "Choose a [TG] Robotics card to add to your hand." All four TG built-ins
// are public, so offering them by name leaks nothing.
const ROBOTIC_ASSEMBLERS = 'roboticAssemblersEffect'
registerEffect(ROBOTIC_ASSEMBLERS, choice({
  effect: ROBOTIC_ASSEMBLERS,
  prompt: 'Choose a [TG] Robotics card to add to your hand',
  options: ({ ctx }) => ctx.catalog
    .filter((c) => c.isBuiltIn && c.faction === 'TG' && c.meta.summonOnly !== true)
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((c) => ({ id: c.cardId, label: c.name })),
  resolve: ({ game, actor, ctx }, choiceId) => {
    const pick = ctx.catalog.find((c) => c.cardId === choiceId)
    // An empty catalog here is an infrastructure bug, not an empty pool.
    if (!pick) return false
    const hand = game.privates[actor].hand
    hand.push({ ...pick, instanceId: ctx.newId() })
    game.state.counts[actor].hand = hand.length
    game.state.log.push(`Player ${actor.toUpperCase()} adds a card to their hand`)
    return true
  },
}), { needsCatalog: true })

// "Spawn a friendly Sapphire into each zone. They have MOBILE and STEALTHY
// keywords." Sapphire already prints both, so the stamp is idempotent and
// kept only because the card text asks for it. Sapphire's own onPlayEffect
// does NOT fire — spawning is not playing (spec §7.4) — which is what keeps a
// 90k ability from also drawing three cards and refunding 90k.
registerEffect('sapphireScreenEffect', spawnVehicles({
  cardName: 'Sapphire',
  count: 1,
  zones: 'all',
  keywords: [KEYWORDS.MOBILE, KEYWORDS.STEALTHY],
}), { needsCatalog: true })
