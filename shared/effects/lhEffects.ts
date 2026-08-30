import { effectiveCostInGame } from '../engine/placement.ts'
import { KEYWORDS } from '../gameSettings.ts'
import {
  choice, drawFromPool, enemyVehicleOptions, grant, sequence, spawnVehicles, summonHulls, whenPlayed, zoneOccupants,
} from './primitives.ts'
import type { EffectFn } from './registry.ts'
import { registerEffect } from './registry.ts'
import { findVehicle, otherSide } from '../engine/gameEngine.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import type { EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'

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

// "Choose one: Spawn a friendly orbit into any zone and give it the TEMPORARY
// keyword, or choose one enemy vehicle and have it fight alone against an
// orbit." Two chained suspensions (spec §4.2/§4.4) behind ONE registry name:
// RESOLVE_PENDING_EFFECT nulls pendingEffect before re-entering, which is
// exactly what lets this continuation suspend a second time.
//
// The two modes are two DIFFERENT mechanisms, and this card is the evidence
// the split lives in the data (spec §4.4): mode (a) is a board spawn
// (spawnVehicles — the Orbit enters zone.cards and stays there; the printed
// Orbit already carries TEMPORARY, so the grant is idempotent and kept only
// to match the card text). Mode (b) is a battle summon (summonHulls +
// declareForcedBattle — the Orbit lives only in ActiveBattle.summons and
// evaporates on report approval regardless of HP, never touching
// zone.cards). Neither passes `activatesZone` — a forced battle is not a
// zone activation, and a spawn never was one either.
//
// The mode chosen at hop 1 is stashed in hop 2's pendingEffect.data and read
// back from payload.pending.data — never inferred from
// payload.resolution.targetInstanceId / .zoneId, which are client-supplied
// and unvalidated (unlike resolution.choiceId, which `choice()` already
// checks against pending.options before resolve() ever sees it). Inferring
// the mode from anything the client sent would let a player choose mode (a)
// and then answer hop 2's dialog as though it were mode (b).
const ORBIT_FLANK = 'orbitFlankEffect'
const ORBIT_FLANK_SPAWN = 'spawn'
const ORBIT_FLANK_BATTLE = 'battle'

registerEffect(ORBIT_FLANK, choice({
  effect: ORBIT_FLANK,
  prompt: 'Choose one: spawn a friendly orbit into any zone, or send an orbit to fight an enemy vehicle alone',
  options: () => [
    { id: ORBIT_FLANK_SPAWN, label: 'Spawn a friendly orbit into any zone' },
    { id: ORBIT_FLANK_BATTLE, label: 'Choose an enemy vehicle to fight an orbit alone' },
  ],
  resolve: (payload, choiceId) => {
    const { game, actor, ctx, card } = payload
    const mode = payload.pending?.data?.mode

    if (mode === ORBIT_FLANK_SPAWN) {
      // Hop 2 of mode (a): choiceId is the chosen zone's id (the string form
      // of ZoneState.id minted into the options below).
      if (typeof choiceId !== 'string') return false
      return spawnVehicles({
        cardName: 'Orbit', count: 1, zones: 'target', keywords: [KEYWORDS.TEMPORARY],
      })({ ...payload, targetZoneId: Number(choiceId) })
    }

    if (mode === ORBIT_FLANK_BATTLE) {
      // Hop 2 of mode (b): choiceId is the chosen enemy vehicle's instanceId.
      if (typeof choiceId !== 'string') return false
      const found = findVehicle(game.state, choiceId)
      if (!found || found.side !== otherSide(actor)) return false
      const summons = summonHulls(game, ctx, 'Orbit', 1)
      if (!summons) return false
      return declareForcedBattle(game, ctx, {
        zoneId: found.zone.id,
        aggressor: actor,
        attackerIds: summons.map((s) => s.instanceId),
        defenderIds: [choiceId],
        summons,
        cause: card.name,
      })
    }

    // Hop 1: choiceId is the mode just picked ('spawn' or 'battle').
    if (choiceId === ORBIT_FLANK_SPAWN) {
      game.state.pendingEffect = {
        effect: ORBIT_FLANK, side: actor, card, kind: 'choice',
        prompt: 'Choose a zone for the Orbit',
        options: game.state.zones.map((z) => ({ id: String(z.id), label: `Zone ${z.id} (${z.biome})` })),
        data: { mode: ORBIT_FLANK_SPAWN },
      }
      game.state.log.push(`${card.name} is waiting on a choice`)
      return true
    }
    if (choiceId === ORBIT_FLANK_BATTLE) {
      // Empty options do not suspend (primitives.ts choice() rule 2 — hand-
      // rolled here since this is hop 2, not choice()'s own first entry): no
      // enemy vehicle anywhere means mode (b) simply fizzles.
      const targets = enemyVehicleOptions(game, actor, null)
      if (targets.length === 0) {
        game.state.log.push(`${card.name} finds no enemy vehicle to challenge`)
        return true
      }
      game.state.pendingEffect = {
        effect: ORBIT_FLANK, side: actor, card, kind: 'choice',
        prompt: 'Choose an enemy vehicle for the Orbit to fight',
        options: targets,
        data: { mode: ORBIT_FLANK_BATTLE },
      }
      game.state.log.push(`${card.name} is waiting on a choice`)
      return true
    }
    return false // unreachable — choice() already validated choiceId against pending.options
  },
}), { needsCatalog: true })

const ECLIPSE = 'eclipseEffect'

const eclipseTargetable = (e: ZoneCardEntry) => !e.keywords.includes(KEYWORDS.STEALTHY)

// "Once per turn this vehicle may target one non-stealthy enemy vehicle in
// its zone to have a 1v1 battle. If you do so, you may not declare a fleet
// battle in this zone this turn." Ships with onActivate already seeded but
// no activateCpCost — ACTIVATE_VEHICLE and BoardZone's button both require
// BOTH keys, so the ability is unreachable without it (spec §6). Eclipse's
// text never mentions CP, unlike Braveheart's "pay 1cp", hence 0 rather than
// 1 — and 0 must be authored explicitly and read via a typeof check, not a
// truthiness one, or the ability is unreachable all over again
// (shared/engine/activate.ts's activateCpCostOf already does this right;
// this file only has to not break it).
//
// DP1 + DP4 (choice, over enemyVehicleOptions scoped to the hull's own zone,
// excluding Stealthy) + DP3 (declareForcedBattle, activatesZone: true).
// Eclipse is the SOLE card that stamps lastActivatedTurn from a forced
// battle (spec §4.3 ruling: "a forced battle is not a zone activation"
// everywhere else — see Braveheart, shared/effects/ssEffects.ts, for the
// ordinary case). The stamp only PREVENTS a later fleet battle in this zone
// this turn; Eclipse's own text says nothing about being blocked by an
// EARLIER one, so no lastActivatedTurn precondition is added here — only
// ACTIVATE_VEHICLE's own activatedOnTurn (this hull, once per turn) gates
// activation at all.
//
// Same no-data-stash reasoning as Braveheart: payload.card is the
// activating hull on both entries, so its zone is re-derived via
// findVehicle(card.instanceId) rather than trusted from the RESOLVE_PENDING_EFFECT
// action. resolve() re-runs the identical enemyVehicleOptions() call (same
// zone, same Stealthy filter) to re-confirm choiceId before declaring the
// battle.
function eclipseZone(game: EngineGame, actor: Side, card: { instanceId: string }) {
  const found = findVehicle(game.state, card.instanceId)
  return found && found.side === actor ? found : null
}

registerEffect(ECLIPSE, choice({
  effect: ECLIPSE,
  prompt: 'Choose a non-Stealthy enemy vehicle for Eclipse to fight',
  options: ({ game, actor, card }) => {
    const self = eclipseZone(game, actor, card)
    return self ? enemyVehicleOptions(game, actor, self.zone.id, eclipseTargetable) : []
  },
  resolve: (payload, choiceId) => {
    const { game, actor, card, ctx } = payload
    if (choiceId === null) return false // no non-Stealthy enemy vehicle in the zone
    const self = eclipseZone(game, actor, card)
    if (!self) return false
    const stillLegal = enemyVehicleOptions(game, actor, self.zone.id, eclipseTargetable).some((o) => o.id === choiceId)
    if (!stillLegal) return false
    return declareForcedBattle(game, ctx, {
      zoneId: self.zone.id,
      aggressor: actor,
      attackerIds: [card.instanceId],
      defenderIds: [choiceId],
      cause: card.name,
      activatesZone: true,
    })
  },
}))

const TERAWATT = 'terawattJoin'

// "Whenever a friendly vehicle would be made to fight in battle alone due to
// enemy card effect, you may add this vehicle to the combat."
//
// Wave 4's only BYSTANDER effect (spec §4.3, DP2 departure 2): it reacts to a
// battle it is not in, which the participant loop cannot reach. The
// { battleBystander: true } flag is what puts it in that pass — and what keeps
// every other DP2 card out of it, so none of them needs an isParticipant guard
// it could silently forget.
//
// Three conditions, each from a different part of the text:
//   "due to enemy card effect" → battle.forced. An ordinary fleet attack is
//     not that, however lonely the defender ends up.
//   "alone"                    → the defending side has exactly one
//     participant. Terawatt itself is excluded: if it IS that participant, the
//     bystander pass skips it as a combatant and the participant pass hands it
//     isParticipant true, which the guard below rejects.
//   the same zone              → ruled in spec §7.3, matching Braveheart's "in
//     the same zone" and Gang Up's "from the same zone". The bystander pass
//     already scopes to the battle's zone; resolve re-derives it anyway,
//     because by then the board may have moved.
//
// This is one of the two effects that can leave state.pendingEffect set while
// state.activeBattle still stands (decision 19). That is safe and tested —
// shared/engine/battleFreeze.test.ts — and the choice is owed by the DEFENDER,
// who is off-turn, which is exactly why RESOLVE_PENDING_EFFECT is an
// OFF_TURN_ACTION.
const terawattChoice = choice({
  effect: TERAWATT,
  prompt: 'Add Terawatt to the battle?',
  options: ({ card }) => [{ id: 'join', label: `Send ${card.name} in` }],
  // payload.card IS the Terawatt hull (the dispatch hands the effect its own
  // zone entry, and pendingEffect carries it verbatim across the suspension),
  // so only the zone needs stashing. Never read back off payload.resolution,
  // which is client-supplied and unvalidated.
  data: ({ battle }) => ({ zoneId: battle?.zoneId }),
  resolve: ({ game, actor, card, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const battle = game.state.activeBattle
    // Re-checked server-side rather than trusted from the first entry: the
    // choice may have sat open while the board moved. "Alone" in particular
    // must still hold — another joiner between the offer and the answer means
    // the vehicle is no longer fighting alone.
    if (!battle || battle.zoneId !== zoneId || battle.defenderIds.length !== 1) return false
    const self = findVehicle(game.state, card.instanceId)
    if (!self || self.side !== actor || self.zone.id !== zoneId) return false
    // No `entry` argument: Terawatt is already on the board, so it joins as an
    // ordinary combatant rather than as a battle summon that would evaporate.
    if (!joinBattle(game, actor, card.instanceId)) return false
    game.state.log.push(`${card.name} joins the battle in zone ${zoneId}`)
    return true
  },
})

registerEffect(TERAWATT, (payload) => {
  if (payload.resolution !== undefined) return terawattChoice(payload)
  const { game, battle } = payload
  if (!battle || battle.phase !== 'lock' || !battle.forced) return true
  if (battle.isParticipant || !battle.isDefender) return true
  const active = game.state.activeBattle
  if (!active || active.defenderIds.length !== 1) return true
  return terawattChoice(payload)
}, { battleBystander: true })
