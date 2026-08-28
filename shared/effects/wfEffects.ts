import {
  ALL_FOR_THE_CAUSE_DOUBLE_COST, KEYWORDS, MARTYR_ATTACK_BOOST_MIN_COST,
  MARTYR_ATTACK_BOOSTED_COUNT, MARTYR_ATTACK_COUNT, VEHICLE_TYPES,
} from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { findVehicle, otherSide } from '../engine/gameEngine.ts'
import { declareForcedBattle } from '../engine/battleDeclare.ts'
import { catalogCard, grant, spawnInto, summonHulls } from './primitives.ts'
import { registerEffect } from './registry.ts'

// WF built-in card effects.
registerEffect('excruciatorOnPlay', grant({ draw: 1 }))
registerEffect('purifierEffect', grant({ draw: 1 }))

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
  return declareForcedBattle(game, {
    zoneId: found.zone.id,
    aggressor: actor,
    attackerIds: summons.map((s) => s.instanceId),
    defenderIds: [targetInstanceId],
    summons,
    cause: card.name,
  })
}, { needsCatalog: true })
