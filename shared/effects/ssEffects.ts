import {
  AIR_STRAFE_PREDATOR_COUNT, EXCALIBUR_DISCOUNT, KEYWORDS, REPAIRMEN_READY_DRAW_MAX_COST,
  RHEA_MAX_PLANE_COST, VEHICLE_TYPES,
} from '../gameSettings.ts'
import { costDelta, choice, drawFromPool, grant, grantKeywords, sequence, summonHulls } from './primitives.ts'
import { registerEffect } from './registry.ts'
import type { EngineGame, Side } from '../engine/engineTypes.ts'
import { findVehicle, otherSide } from '../engine/gameEngine.ts'
import { declareForcedBattle } from '../engine/battleDeclare.ts'

// SS built-in card effects.
registerEffect('resoluteOnPlay', grant({ draw: 1 }))
registerEffect('ironMaidenOnDeath', grant({ draw: 1 }))
registerEffect('victoriaOnDeath', grant({ draw: 1 }))
registerEffect('trondheimOnDeath', grant({ draw: 1 }))
registerEffect('maelstromOnPlay', grant({ cp: 1 }))

registerEffect('rheaOnPlay', drawFromPool({
  source: 'catalog',
  filter: { faction: 'SS', vehicleType: 'plane', maxCost: RHEA_MAX_PLANE_COST - 1 },
  count: 1,
  strip: ['temporary'],
}), { needsCatalog: true })

// "Pick one AI ship in hand and reduce its cost by 200k." AI means built-in
// (design spec §3.10, "AI/built-in card costs").
registerEffect('excaliburOnPlay', costDelta({
  delta: -EXCALIBUR_DISCOUNT,
  filter: { isBuiltIn: true, vehicleType: 'ship', type: 'vehicle' },
}))

// "Grant target vehicle scrappy. If the target is an AI vehicle that costs
// less than 200k, draw a card."
registerEffect('repairmenReadyEffect', sequence(
  grantKeywords({ keywords: [KEYWORDS.SCRAPPY], target: 'field' }),
  (payload) => {
    const found = findVehicle(payload.game.state, payload.targetInstanceId ?? '')
    if (!found) return false
    const { entry } = found
    if (entry.isBuiltIn && entry.materialCost < REPAIRMEN_READY_DRAW_MAX_COST) {
      return grant({ draw: 1 })(payload)
    }
    return true
  },
))

const AIR_STRAFE = 'airStrafeEffect'

// Enemy ships only — card text says "Choose an enemy ship", not the looser
// "vehicle" other forced-battle cards use. Shared by the choice's options(),
// its immediate (no-choice) resolve branch, and re-entry's re-validation.
function legalTarget(game: EngineGame, actor: Side, targetInstanceId: unknown) {
  if (typeof targetInstanceId !== 'string') return null
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return null
  if (found.entry.vehicleType !== VEHICLE_TYPES.SHIP) return null
  return found
}

// "Choose an enemy ship, it fights alone against two PredatorX. If the
// target is a player design, also spawn your choice of Hydra or Cyclone."
// Seed corrected PLAY_ON_ZONE -> PLAY_ON_VEHICLE — the card targets a
// vehicle, not a zone. The printed "spawn" is loose: spec §4.4 puts all
// three hulls in ActiveBattle.summons — they exist only for this battle and
// evaporate at its end, never touching zone.cards — the same family as
// Flying Squirrel Attack and Martyr Attack, not Defensive Parapet.
//
// "AI" / "player design" is isBuiltIn true/false (spec §7.3). A built-in
// target needs no choice: options() returns [] and `choice` calls
// resolve(payload, null) in the very same action, so the battle still
// declares immediately with 2 summons — no suspension, no dialog. A player
// design must suspend FIRST and declare the battle only from the
// continuation (design spec §4.3, worked out in the task brief): once
// pendingEffect is set the game freezes to PENDING_ACTIONS, which admits no
// battle action, so a battle declared before the choice resolves could
// never be reported and would deadlock the game.
//
// RESOLVE_PENDING_EFFECT carries neither the original targetInstanceId nor a
// zoneId forward on its own — first entry's are gone by re-entry. Its action
// shape does carry both (`resolution.targetInstanceId` / `.zoneId`), but
// they are client-supplied and unvalidated: trusting them would let a stale
// or malicious client redirect the strike to a different vehicle/zone
// between the two halves of the play. The target's instanceId and zoneId
// are stashed in the choice's `data` on first entry instead, and re-entry
// reads only those back (docs/claude/card-effects.md, "Suspending for a
// choice").
registerEffect(AIR_STRAFE, choice({
  effect: AIR_STRAFE,
  prompt: 'Choose a hull to join Air Strafe',
  options: ({ game, actor, targetInstanceId }) => {
    const found = legalTarget(game, actor, targetInstanceId)
    if (!found || found.entry.isBuiltIn) return []
    return [{ id: 'Hydra', label: 'Hydra' }, { id: 'Cyclone', label: 'Cyclone' }]
  },
  data: ({ game, actor, targetInstanceId }) => {
    const found = legalTarget(game, actor, targetInstanceId)
    return found ? { targetInstanceId: found.entry.instanceId, zoneId: found.zone.id } : {}
  },
  resolve: (payload, choiceId) => {
    const { game, actor, ctx, card } = payload
    if (choiceId === null) {
      // Empty options: either an illegal target (rejected below) or a
      // legal built-in one — options() already told them apart, but resolve
      // has no direct view of that decision, so it re-derives from the same
      // first-entry payload. This branch never runs on a re-entry (see
      // primitives.ts choice()), so targetInstanceId is still live here.
      const found = legalTarget(game, actor, payload.targetInstanceId)
      if (!found) return false
      const summons = summonHulls(game, ctx, 'PredatorX', AIR_STRAFE_PREDATOR_COUNT)
      if (!summons) return false
      return declareForcedBattle(game, {
        zoneId: found.zone.id,
        aggressor: actor,
        attackerIds: summons.map((s) => s.instanceId),
        defenderIds: [found.entry.instanceId],
        summons,
        cause: card.name,
      })
    }
    // Re-entry: choiceId is 'Hydra' or 'Cyclone' (choice() already checked
    // it against pending.options, so it needs no re-validation here). Read
    // the target back from the stash — never from `payload.resolution`.
    // declareForcedBattle's own on-field check (against the stashed zone)
    // is what re-confirms the id is still on the board there; the
    // enemy-side/ship check below covers what that check cannot (the target
    // is no longer a ship, or no longer the actor's enemy).
    const stash = payload.pending?.data
    const stashedId = stash?.targetInstanceId
    const stashedZoneId = stash?.zoneId
    if (typeof stashedId !== 'string' || typeof stashedZoneId !== 'number') return false
    if (!legalTarget(game, actor, stashedId)) return false
    const predators = summonHulls(game, ctx, 'PredatorX', AIR_STRAFE_PREDATOR_COUNT)
    const hull = summonHulls(game, ctx, choiceId, 1)
    if (!predators || !hull) return false
    const summons = [...predators, ...hull]
    return declareForcedBattle(game, {
      zoneId: stashedZoneId,
      aggressor: actor,
      attackerIds: summons.map((s) => s.instanceId),
      defenderIds: [stashedId],
      summons,
      cause: card.name,
    })
  },
}), { needsCatalog: true })
