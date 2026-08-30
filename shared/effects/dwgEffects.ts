import {
  DOUBLE_UP_MAX_COST, FLYING_SQUIRREL_ATTACK_COUNT, HERO_POWER_LABELS, KEYWORDS,
  MARAUDER_DISCOUNT, RESERVES_CARD_COUNT,
} from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { copyMeta, drawCard, findVehicle, otherSide, zoneById } from '../engine/gameEngine.ts'
import { effectiveMaterialCostOf } from '../engine/placement.ts'
import { declareForcedBattle } from '../engine/battleDeclare.ts'
import { choice, grant, summonHulls, takeFromEnemyDeck } from './primitives.ts'
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
  deck.push({ ...snapshot, instanceId: ctx.newId(), materialCost: 0, meta: copyMeta(snapshot.meta) })
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
  // Mints straight from the catalog rather than through drawFromPool, so the
  // summonOnly exclusion (spec §7.4) does not come for free — it must be
  // repeated here by hand. Without it this pool matches Flying Squirrel.
  const pool = ctx.catalog.filter((c) =>
    c.isBuiltIn && c.faction === 'DWG' && c.type === 'vehicle' && c.meta.summonOnly !== true)
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
    playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
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

// "When played, refresh one of your hero powers then gain 1cp." With no used
// power there is nothing to refresh, and `choice` resolves without suspending
// so the CP still lands.
const KRAKEN = 'krakenOnPlay'
registerEffect(KRAKEN, choice({
  effect: KRAKEN,
  prompt: 'Refresh one of your used hero powers',
  options: ({ game, actor }) =>
    game.state.usedHeroPowers[actor].map((p) => ({ id: p, label: HERO_POWER_LABELS[p] ?? p })),
  resolve: ({ game, actor }, choiceId) => {
    if (choiceId === null) {
      game.state.log.push('Kraken finds no used hero power to refresh')
    } else {
      game.state.usedHeroPowers[actor] = game.state.usedHeroPowers[actor].filter((p) => p !== choiceId)
      game.state.log.push(`Kraken refreshes ${HERO_POWER_LABELS[choiceId] ?? choiceId}`)
    }
    game.state.resources[actor].cp += 1
    return true
  },
}))

// "Choose an enemy vehicle, that vehicle fights alone against a flying
// squirrel (3x squadron)." DP3 (spec §4.3): the target is the sole defender
// (§7.3 "fights alone") against FLYING_SQUIRREL_ATTACK_COUNT freshly minted
// Flying Squirrel summons, which exist only for this battle (spec §4.4) — the
// aggressor is the player who played the card, not the target's owner.
registerEffect('flyingSquirrelAttackEffect', ({ game, actor, ctx, targetInstanceId, card }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const summons = summonHulls(game, ctx, 'Flying Squirrel', FLYING_SQUIRREL_ATTACK_COUNT)
  if (!summons) return false
  return declareForcedBattle(game, ctx, {
    zoneId: found.zone.id,
    aggressor: actor,
    attackerIds: summons.map((s) => s.instanceId),
    defenderIds: [targetInstanceId],
    summons,
    cause: card.name,
  })
}, { needsCatalog: true })

// "Choose an enemy vehicle. Start a battle with that vehicle vs all your
// vehicles from the same zone." DP3: the target is the sole defender (§7.3);
// the attackers are the actor's own vehicles already in that zone, minus any
// Inoffensive ones (§7.3 — Inoffensive means "cannot attack", and a forced
// battle is not licence to break that). No summons. If that leaves no
// attacker, declareForcedBattle's own empty-list check fails the play.
registerEffect('gangUpEffect', ({ game, actor, ctx, targetInstanceId, card }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const attackerIds = found.zone.cards[actor]
    .filter((c) => !c.keywords.includes(KEYWORDS.INOFFENSIVE))
    .map((c) => c.instanceId)
  return declareForcedBattle(game, ctx, {
    zoneId: found.zone.id,
    aggressor: actor,
    attackerIds,
    defenderIds: [targetInstanceId],
    cause: card.name,
  })
})
