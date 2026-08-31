import {
  AIR_STRAFE_PREDATOR_COUNT, CATSHARK_MATERIALS, EXCALIBUR_COST_DELTA, KEYWORDS,
  REPAIRMEN_READY_DRAW_MAX_COST, RHEA_MAX_PLANE_COST, SACRILEGO_HP_BOOST,
  SURVIVE_HP_PERCENT, VEHICLE_TYPES,
} from '../gameSettings.ts'
import {
  catalogCard, costDelta, choice, drawFromPool, enemyVehicleOptions, grant, grantKeywords,
  sacrificeToSave, sequence, spawnInto, spawnVehicles, summonHulls,
} from './primitives.ts'
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

// "Whenever this vehicle is played into a zone, also create a friendly
// Sacrilego in that zone." Spawning is not playing (spec §7.4), which skips
// the spawned hull's onPlayEffect and NOTHING else — so the Sacrilego keeps
// its printed onBattleEffect and will fire it when it fights (spec §7.3,
// wave 6). That is the point of naming Sacrilego rather than a vanilla hull.
registerEffect('nothungOnPlay', spawnVehicles({
  cardName: 'Sacrilego', count: 1, zones: 'target',
}), { needsCatalog: true })

// Orphaned by the 2026-08-30 balance pass, which replaced Victoria's
// draw-on-death text with an activated ability and dropped the key. Kept
// registered rather than deleted: a game dealt before that pass carries a
// frozen snapshot still naming it, and the name must never be reused for
// anything else (spec §9.2). Rhea, below, is the same story — the pass
// retired the card outright.
registerEffect('rheaOnPlay', drawFromPool({
  source: 'catalog',
  filter: { faction: 'SS', vehicleType: 'plane', maxCost: RHEA_MAX_PLANE_COST - 1 },
  count: 1,
  strip: ['temporary'],
}), { needsCatalog: true })

// "Pick one AI ship in hand and reduce its cost by 200k." AI means built-in
// (design spec §7.3, "AI" === isBuiltIn true). Dispatched by DP6's hand
// direction (PLAY_CARD_TARGETING_CARD_IN_HAND, spec §4.3): Excalibur deploys
// to its zone first, then this fires against the hand target, and Excalibur
// itself is not spendCard'd — it is a hull, not a spent ability.
registerEffect('excaliburEffect', costDelta({
  delta: EXCALIBUR_COST_DELTA,
  filter: { type: 'vehicle', vehicleType: 'ship', isBuiltIn: true },
}))

// "Grant target vehicle scrappy. If the target is an AI vehicle that costs
// less than 400k, draw a card." The threshold moved 200k -> 400k in the
// 2026-08-30 balance pass; it lives in REPAIRMEN_READY_DRAW_MAX_COST, so the
// card text is the only other place the number appears.
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
// continuation (design spec §4.3): the choice has to be answered before there
// is a battle to report, because pendingEffect freezes the game to
// PENDING_ACTIONS and no battle action is in that set.
//
// NOTE for later waves: this comment used to argue that the reverse order
// would DEADLOCK the game. That is no longer true — wave 4 makes
// pendingEffect and activeBattle coexisting routine and safe (decision 19,
// shared/engine/battleFreeze.test.ts), and Terawatt and DWG Waters both do it
// deliberately. What still holds is narrower: Air Strafe needs the answer to
// know how many hulls to summon, so it cannot declare first.
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
      return declareForcedBattle(game, ctx, {
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
    return declareForcedBattle(game, ctx, {
      zoneId: stashedZoneId,
      aggressor: actor,
      attackerIds: summons.map((s) => s.instanceId),
      defenderIds: [stashedId],
      summons,
      cause: card.name,
    })
  },
}), { needsCatalog: true })

const BRAVEHEART = 'braveheartActivate'

// "Once per turn, you may pay 1cp to have this ship 1v1 an enemy vehicle in
// the same zone." Ships with meta: {} — the effect name and
// activateCpCost: 1 are both content this wave authors, not merely
// implements (spec §6, "Cards shipped with no authored effect name").
// DP1 (ACTIVATE_VEHICLE pays the CP and stamps activatedOnTurn BEFORE this
// ever runs — shared/engine/activate.ts — so once-per-turn is free here) +
// DP4 (this choice, over enemyVehicleOptions scoped to the hull's OWN zone —
// unlike Orbit Flank's zoneId: null) + DP3 (declareForcedBattle,
// attackerIds: [self], no summons).
//
// Unlike Air Strafe/Orbit Flank, no `data` stash is needed: payload.card on
// BOTH entries IS the activating hull — ACTIVATE_VEHICLE hands the effect
// the zone entry itself, and pendingEffect carries the card verbatim across
// the suspension (spec §4.2) — so its zone is re-derived identically in
// options() and resolve() via findVehicle(card.instanceId), never trusted
// from the client-supplied, unvalidated RESOLVE_PENDING_EFFECT fields
// (docs/claude/card-effects.md, "Suspending for a choice"). choiceId is the
// chosen enemy's instanceId; `choice()` already checks it against
// pending.options, and resolve() re-runs the identical enemyVehicleOptions()
// call to re-confirm the target before declaring the battle.
function braveheartZone(game: EngineGame, actor: Side, card: { instanceId: string }) {
  const found = findVehicle(game.state, card.instanceId)
  return found && found.side === actor ? found : null
}

registerEffect(BRAVEHEART, choice({
  effect: BRAVEHEART,
  prompt: 'Choose an enemy vehicle for Braveheart to fight',
  options: ({ game, actor, card }) => {
    const self = braveheartZone(game, actor, card)
    return self ? enemyVehicleOptions(game, actor, self.zone.id) : []
  },
  resolve: (payload, choiceId) => {
    const { game, actor, card, ctx } = payload
    if (choiceId === null) return false // no enemy vehicle in the zone — nothing to fight
    const self = braveheartZone(game, actor, card)
    if (!self) return false
    const stillLegal = enemyVehicleOptions(game, actor, self.zone.id).some((o) => o.id === choiceId)
    if (!stillLegal) return false
    // No activatesZone: a forced battle is not a zone activation (spec §4.3
    // ruling) — Eclipse alone is the exception, and says so in its own text.
    // A fleet attack in this zone later this turn is unaffected.
    return declareForcedBattle(game, ctx, {
      zoneId: self.zone.id,
      aggressor: actor,
      attackerIds: [card.instanceId],
      defenderIds: [choiceId],
      cause: card.name,
    })
  },
}))

// ---------------------------------------------------------------------------
// Wave 4 — DP2 (spec §4.3). Both of these fire at battle LOCK, and both guard
// on `isParticipant`: a DP2 effect can also be reached as a forced-battle
// bystander, and neither card's text describes a battle it is not in.
// ---------------------------------------------------------------------------

// "Whenever this vehicle participates in a fleet combat, gain 30k resources
// this turn." Either side — a battle it participates in is a battle whatever
// declared it (spec §7.3), so no isDefender check. "This turn" needs no rider:
// endTurn overwrites the incoming side's materials outright.
registerEffect('catsharkBattle', (payload) => {
  const { battle } = payload
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant) return true
  return grant({ materials: CATSHARK_MATERIALS })(payload)
})

// "Whenever this ship participates in a defensive battle, spawn another dryad
// into the zone under your control." A BOARD spawn, not a battle summon —
// "spawn ... into the zone" is spec §4.4's wording for the permanent kind — so
// the new hull enters zone.cards and does NOT join the battle in progress.
//
// It carries the same trigger, so it will spawn again in a later defensive
// battle it takes part in. That compounding is the card; nothing here caps it.
// Within ONE lock it cannot re-trigger, because the dispatch walks a roster
// snapshotted before any effect runs (battleTriggers.ts).
registerEffect('dryadBattle', ({ game, actor, ctx, battle }) => {
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant || !battle.isDefender) return true
  const snapshot = catalogCard(ctx, 'Dryad')
  // A card missing from the catalog is a data bug, not an empty pool — the
  // same contract spawnVehicles and summonHulls both use.
  if (!snapshot) return false
  if (!spawnInto(game, ctx, actor, battle.zoneId, snapshot)) return false
  game.state.log.push(`Another Dryad takes root in zone ${battle.zoneId}`)
  return true
}, { needsCatalog: true })

const SACRILEGO = 'sacrilegoBattle'

// Clause 2. "Increase the remaining hp percent of a friendly ship by 15" is
// implemented where the boost is observable and nowhere else (spec §7.3, the
// same reasoning applied to Trebuchet's "fully heal it"): the board tracks no
// HP, so the only difference +15 can make is turning a destroyed ship into a
// surviving one. Eligible = a friendly SHIP destroyed at SURVIVE_HP_PERCENT −
// SACRILEGO_HP_BOOST or better, where the boost would have carried it over the
// line. The band is derived, never written as a literal.
const sacrilegoSave = sacrificeToSave({
  effect: SACRILEGO,
  prompt: 'Sacrifice Sacrilego to save a friendly ship?',
  eligible: (battle, actor) => battle.casualties.filter((c) =>
    c.side === actor &&
    c.entry.vehicleType === VEHICLE_TYPES.SHIP &&
    c.hp >= SURVIVE_HP_PERCENT - SACRILEGO_HP_BOOST),
})

// "Whenever this vehicle survives a fleet battle, gain 1cp. Additionally you
// may sacrifice it to increase the remaining hp percent of a friendly ship by
// 15." Two clauses, one registry name, told apart by the payload: a DP2
// resolve trigger carries `battle`, and RESOLVE_PENDING_EFFECT's re-entry
// carries `resolution` and no battle at all.
//
// Clause 1 does not depend on clause 2 and runs first, so the CP lands even
// when nothing is eligible — `choice`'s empty-options rule then resolves in
// the same action without suspending.
registerEffect(SACRILEGO, (payload) => {
  if (payload.resolution !== undefined) return sacrilegoSave(payload)
  const { battle } = payload
  if (!battle || battle.phase !== 'resolve' || !battle.isParticipant || !battle.survived) return true
  grant({ cp: 1 })(payload)
  return sacrilegoSave(payload)
})
