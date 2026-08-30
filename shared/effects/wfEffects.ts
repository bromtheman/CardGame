import {
  AMBUSH_DISTANCE_M, SPAWN_DISTANCE_MIN_M,
  ALL_FOR_THE_CAUSE_DOUBLE_COST, KEYWORDS, MARTYR_ATTACK_BOOST_MIN_COST,
  MARTYR_ATTACK_BOOSTED_COUNT, MARTYR_ATTACK_COUNT, VEHICLE_TYPES,
} from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { findVehicle, otherSide, zoneById } from '../engine/gameEngine.ts'
import { declareForcedBattle } from '../engine/battleDeclare.ts'
import { catalogCard, choice, grant, spawnInto, summonHulls } from './primitives.ts'
import { registerEffect } from './registry.ts'
import type { EffectPayload } from './registry.ts'

// WF built-in card effects.
registerEffect('excruciatorOnPlay', grant({ draw: 1 }))
registerEffect('purifierEffect', grant({ draw: 1 }))

const AMBUSH = 'ambushEffect'

// "Choose a zone. During the next offensive battle you fight there this turn,
// you may deploy your ships after the defending player and you may position
// your ships 600m closer to the enemy. If the turn ends and you have not
// fought in that zone, draw a card."
//
// DP5's zone half (spec §4.3, "DP5 as wave 5 built it"). One registry name,
// three occasions told apart by the payload — the shape dwgWatersEffect
// established, and the reason it must stay one name: the zoneEffects entry
// stores the name it was claimed under, and that is what dispatches the rider
// once the card itself is spent.
//
//   no battle, no resolution     → claim the zone
//   battle.phase === 'lock',
//     and we are the aggressor   → spend the rider, then offer
//   resolution                   → apply what was offered
//
// The tail ("draw if the turn ends unused") is endTurn's, driven by
// data.drawOnExpiry — see gameEngine.ts's turnEndRiders.
//
// { needsCatalog: true } is NOT optional and NOT about this effect's own
// needs: the rider dispatch mints its payload card from ctx.catalog by
// cardName, so without the flag game-action never loads a catalog and the
// rider is silently skipped in production while every unit test passes.
function ambushClaim({ game, actor, card, targetZoneId }: EffectPayload): boolean {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  if (!zone) return false
  // A second ambush on a zone you already hold one in buys nothing — refuse
  // before the handler commits, so the play is not spent on a no-op
  // (dwgWatersClaim refuses a re-claim for the same reason).
  const held = game.state.zoneEffects.some(
    (e) => e.effect === AMBUSH && e.zoneId === targetZoneId && e.side === actor,
  )
  if (held) return false
  game.state.zoneEffects.push({
    effect: AMBUSH, zoneId: targetZoneId, side: actor, cardName: card.name,
    setOnTurn: game.turnNumber,
    // "this turn" / "if the turn ends": both halves expire together, at this
    // player's own END_TURN (spec §7.3).
    expiresOnTurn: game.turnNumber,
    data: { drawOnExpiry: true },
  })
  game.state.log.push(
    `Player ${actor.toUpperCase()} sets an ambush in zone ${targetZoneId} — for the rest of the turn`,
  )
  return true
}

// The offer. Both printed permissions ride on one yes/no: the deploy order is
// a rule the players apply in From The Depths (the log line is how the
// DEFENDER learns of it, which is why it must be public), and the distance is
// the half the engine can actually hold.
const ambushOffer = choice({
  effect: AMBUSH,
  prompt: 'Spring your ambush — deploy after the defender, and start 600m closer?',
  options: () => [{ id: 'spring', label: `Deploy last, ${AMBUSH_DISTANCE_M}m closer` }],
  data: ({ battle }) => ({ zoneId: battle?.zoneId }),
  resolve: ({ game, actor, card, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const battle = game.state.activeBattle
    // The battle may have gone while the choice sat open.
    if (!battle || battle.zoneId !== zoneId) return false
    // Clamped exactly as tacticalPositioning clamps — but distanceModifiedBy
    // is deliberately untouched: that list is the hero power's once-per-side
    // ledger, and a card must not spend it (spec §7.3).
    battle.distanceM = Math.max(SPAWN_DISTANCE_MIN_M, battle.distanceM - AMBUSH_DISTANCE_M)
    game.state.log.push(
      `${card.name}: player ${actor.toUpperCase()} deploys after the defender, at ${battle.distanceM}m`,
    )
    return true
  },
})

// "The NEXT offensive battle you fight there this turn." A bombardment is not
// a battle fought, so only phase 'lock' springs it — which is also what makes
// the "you have not fought in that zone" tail read correctly.
function ambushSpring(payload: EffectPayload): boolean {
  const { game, actor, battle } = payload
  if (!battle || battle.phase !== 'lock' || battle.isDefender) return true
  const before = game.state.zoneEffects.length
  // Spent BEFORE the offer is made, not after it is answered: the card's
  // compensation clause is "if the turn ends and you have not FOUGHT there",
  // so a decline — or an offer dropped for an occupied slot (spec §4.3, DP2
  // departure 4) — still spends it.
  game.state.zoneEffects = game.state.zoneEffects.filter(
    (e) => !(e.effect === AMBUSH && e.zoneId === battle.zoneId && e.side === actor),
  )
  if (game.state.zoneEffects.length === before) return true
  return ambushOffer(payload)
}

registerEffect(AMBUSH, (payload) => {
  if (payload.resolution !== undefined) return ambushOffer(payload)
  if (payload.battle) return ambushSpring(payload)
  return ambushClaim(payload)
}, { needsCatalog: true })

// "Choose a zone. Give all friendly vehicles in that zone the TEMPORARY
// keyword, then spawn a Martyr for each vehicle affected. If the vehicle
// costed more than 250k, summon two instead."
//
// The occupant list is snapshotted before spawning: spawnInto pushes into the
// same array, so iterating it live would stamp the new Martyrs Temporary and
// spawn Martyrs for Martyrs.
registerEffect('allForTheCauseEffect', ({ game, actor, ctx, targetZoneId }) => {
  const zone = game.state.zones.find((z) => z.id === targetZoneId)
  if (!zone) return false
  const martyr = catalogCard(ctx, 'Martyr')
  if (!martyr) return false

  const affected = [...zone.cards[actor]] as ZoneCardEntry[]
  if (affected.length === 0) {
    game.state.log.push('All for the Cause finds no friendly vehicles in that zone')
    return true
  }

  let spawned = 0
  for (const entry of affected) {
    if (!entry.keywords.includes(KEYWORDS.TEMPORARY)) {
      entry.keywords = [...entry.keywords, KEYWORDS.TEMPORARY]
    }
    const copies = entry.materialCost > ALL_FOR_THE_CAUSE_DOUBLE_COST ? 2 : 1
    for (let i = 0; i < copies; i++) {
      if (spawnInto(game, ctx, actor, zone.id, martyr)) spawned++
    }
  }
  game.state.log.push(
    `All for the Cause: ${affected.length} vehicle(s) go Temporary and ${spawned} Martyr(s) answer in zone ${zone.id}`,
  )
  return true
}, { needsCatalog: true })

// "Choose an enemy vehicle. It enters a fight alone against 4 Martyrs. If it
// is an airship, or a player design costing 400k+, it fights 6 Martyrs
// instead." DP3 (spec §4.3): the target is the sole defender (§7.3) against
// freshly minted Martyr summons (spec §4.4). "Player design" is
// isBuiltIn === false (spec §7.3); the airship clause is independent of cost
// — a built-in airship of any price still gets the boosted count. The cost
// check reads the printed materialCost, never effectiveMaterialCostOf — a
// Half-Cost target must not slip under the threshold.
registerEffect('martyrAttackEffect', ({ game, actor, ctx, targetInstanceId, card }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const { entry } = found
  const boosted = entry.vehicleType === VEHICLE_TYPES.AIRSHIP ||
    (entry.isBuiltIn === false && entry.materialCost >= MARTYR_ATTACK_BOOST_MIN_COST)
  const count = boosted ? MARTYR_ATTACK_BOOSTED_COUNT : MARTYR_ATTACK_COUNT
  const summons = summonHulls(game, ctx, 'Martyr', count)
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
