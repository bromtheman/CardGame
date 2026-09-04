import {
  AIR_STRAFE_PREDATOR_COUNT, BASE_DAMAGE_DIVISOR, BULL_SHARK_BASE_DAMAGE, CASH_ADVANCE_MATERIALS,
  CATSHARK_MATERIALS,
  EXCALIBUR_COST_DELTA, FACTIONS, KEYWORDS, NOTHUNG_COST_DELTA,
  REPAIRMEN_READY_DRAW_MAX_COST, RESOLUTE_COST_DELTA, RHEA_MAX_PLANE_COST, SACRILEGO_HP_BOOST,
  SURVIVE_HP_PERCENT, TRONDHEIM_COST_DELTA, TYR_HAND_DISCOUNT, VEHICLE_TYPES, VICTORIA_COST_DELTA,
} from '../gameSettings.ts'
import {
  catalogCard, costDelta, choice, drawFromPool, enemyVehicleOptions, friendlyVehicleOptions, grant,
  grantKeywords, poolEligible, sacrificeToSave, sequence, spawnInto, summonHulls,
} from './primitives.ts'
import { registerCostModifier, registerEffect } from './registry.ts'
import type { EffectFn, EffectPayload } from './registry.ts'
import type { EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import { checkVictory, findVehicle, otherSide, putInHand, zoneById } from '../engine/gameEngine.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import type { CardInstance } from '../engine/gameInit.ts'

// "an SS ship" — the pool five cards in this wave share (Victoria, Trondheim,
// Nothung, Sacrilego, Argonaut, Resolute). Written once so a later card cannot
// disagree with an earlier one about what the phrase means.
//
// It is a FACTION filter, not a card list, so it grows with the faction —
// which is the trap ruling L-1 records for the LH robotics pool. That is fine
// here and was not there: these cards print "SS ship", the faction IS the
// intended pool, and SS is fully seeded.
const SS_SHIP_FILTER = {
  faction: FACTIONS.SS, type: 'vehicle', vehicleType: VEHICLE_TYPES.SHIP,
} as const

// Exported: only Nothung (this file, below), Sacrilego and Argonaut (Tasks
// 16, 21) call these two — Trondheim/Resolute (Task 11) and Excalibur
// (Task 13) go through SS_SHIP_FILTER via drawFromPool/costDelta instead.
// Kept exported for the not-yet-landed callers: an unexported symbol with no
// call site inside this file trips frontend/tsconfig.app.json's
// noUnusedLocals (TS6133) the moment npm --prefix frontend run build pulls in
// ../shared — export makes both exempt while the remaining call sites land.
export const isSsShip = (c: CardInstance): boolean =>
  c.faction === FACTIONS.SS && c.type === 'vehicle' && c.vehicleType === VEHICLE_TYPES.SHIP

// The accumulate-don't-replace stamp, matching primitives.ts's costDelta() so a
// card discounted twice is discounted twice. Used by the four effects that hit
// a card already in hand without a player picking it.
export function discountInHand(card: CardInstance, delta: number): void {
  const current = typeof card.meta.costDelta === 'number' ? card.meta.costDelta : 0
  card.meta = { ...card.meta, costDelta: current + delta }
}

// SS built-in card effects.
registerEffect('ironMaidenOnDeath', grant({ draw: 1 }))
registerEffect('victoriaOnDeath', grant({ draw: 1 }))
registerEffect('maelstromOnPlay', grant({ cp: 1 }))

// "When this vehicle is destroyed, draw an SS ship from your deck and reduce
// its cost by 75k." / Resolute's on-play twin at 40k.
//
// From the owner's DECK, not the catalog — which is why neither carries
// { needsCatalog: true } (spec §7.1 names both as the near miss that "it draws
// a card" would get wrong). A deck pool is legitimately empty, so
// drawFromPool's allowEmpty default resolves rather than failing: a death
// effect that returned false would log a failed trigger on every Trondheim that
// dies with no SS ship left.
registerEffect('trondheimOnDeath', drawFromPool({
  source: 'deck', filter: SS_SHIP_FILTER, count: 1, costDelta: TRONDHEIM_COST_DELTA,
}))
registerEffect('resoluteOnPlay', drawFromPool({
  source: 'deck', filter: SS_SHIP_FILTER, count: 1, costDelta: RESOLUTE_COST_DELTA,
}))

// "When this vehicle is played, reduce the cost of every SS ship in your hand
// by 40k." This REPLACES the Sacrilego spawn the card used to print — same
// registry id, new behaviour, which is what a balance pass is and is not the
// R-6 collision (that is two DIFFERENT cards sharing a name).
//
// No { needsCatalog: true } any more: the spawn read ctx.catalog, this reads
// only the hand.
//
// ⚠ The log carries neither names NOR a count. state.log is public, and "refits
// 3 ships" tells the opponent how many SS ships are in a hidden hand.
registerEffect('nothungOnPlay', ({ game, actor, card }) => {
  for (const held of game.privates[actor].hand) {
    if (isSsShip(held)) discountInHand(held, NOTHUNG_COST_DELTA)
  }
  game.state.log.push(`${card.name} refits the SS ships in player ${actor.toUpperCase()}'s hand`)
  return true
})

// "When this is played into a zone, create a hydra card in hand and reduce its
// cost to zero."
//
// The reduction is a PRICE, not a rewrite (spec §7.3, wave 6): costDelta is
// summed into effectiveCostInGame and never reaches effectiveMaterialCostOf,
// so the free Hydra still deals its printed base damage and still costs its
// printed repair — which is what "reduce its COST" says. Minting at
// materialCost: 0 would silently make it harmless as well as free.
// loggerheadOnDeath does mint at zero and is NOT the precedent: its copy goes
// into a DECK, where nothing but the price ever reads that number.
//
// This filters the catalog by name directly rather than going through
// drawFromPool, so it uses the shared poolEligible predicate rather than
// drawFromPool's own filter (docs/claude/architecture.md — reservesEffect
// missed exactly this before the predicate existed).
registerEffect('balmungOnPlay', ({ game, actor, ctx }) => {
  const hydra = catalogCard(ctx, 'Hydra')
  // A named card the catalog cannot supply is a data bug, not an empty pool,
  // so this fails the play rather than fizzling — the same contract
  // spawnVehicles uses for the same reason.
  if (!hydra || !poolEligible(hydra)) return false
  putInHand(game, actor, {
    ...hydra,
    instanceId: ctx.newId(),
    meta: { ...hydra.meta, costDelta: -hydra.materialCost },
  })
  // Never named: state.log is public and this card is entering a hidden hand.
  game.state.log.push(`Balmung forges a hull into player ${actor.toUpperCase()}'s hand, free of charge`)
  return true
}, { needsCatalog: true })

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

// "Pick one SS ship in hand and reduce its cost by 200k." The filter moved
// AI -> SS in the 2026-09-02 pass (ruling R-5), so it is now a FACTION test
// rather than isBuiltIn — which both narrows it (a built-in DWG ship no longer
// qualifies) and widens it (a player-made SS ship now does). WF Excruciator's
// text still says "AI" and keeps the built-in meaning; the phrase is not
// global. Dispatched by DP6's hand direction (PLAY_CARD_TARGETING_CARD_IN_HAND,
// spec §4.3): Excalibur deploys to its zone first, then this fires against the
// hand target, and Excalibur itself is not spendCard'd — it is a hull, not a
// spent ability.
registerEffect('excaliburEffect', costDelta({
  delta: EXCALIBUR_COST_DELTA,
  filter: SS_SHIP_FILTER,
}))

// "Grant target vehicle scrappy. If the target is an SS vehicle that costs
// less than 400k, draw a card." The threshold moved 200k -> 400k in the
// 2026-08-30 balance pass; it lives in REPAIRMEN_READY_DRAW_MAX_COST, so the
// card text is the only other place the number appears. The gate read
// "an SS vehicle" since the 2026-09-02 pass (R-5) — it read `isBuiltIn` when
// the text said "AI". Note this clause tests the FACTION and not the ship
// type: the card says "vehicle", where Excalibur says "ship".
registerEffect('repairmenReadyEffect', sequence(
  grantKeywords({ keywords: [KEYWORDS.SCRAPPY], target: 'field' }),
  (payload) => {
    const found = findVehicle(payload.game.state, payload.targetInstanceId ?? '')
    if (!found) return false
    const { entry } = found
    if (entry.faction === FACTIONS.SS && entry.materialCost < REPAIRMEN_READY_DRAW_MAX_COST) {
      return grant({ draw: 1 })(payload)
    }
    return true
  },
))

const AIR_STRAFE = 'airStrafeEffect'

// Any enemy VEHICLE since the 2026-09-02 pass — the card text used to say "an
// enemy ship" and now says "an enemy vehicle". Shared by the choice's
// options(), its immediate (no-choice) resolve branch, and re-entry's
// re-validation, so all three widened together.
function legalTarget(game: EngineGame, actor: Side, targetInstanceId: unknown) {
  if (typeof targetInstanceId !== 'string') return null
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return null
  return found
}

// "Choose an enemy vehicle, it fights alone against two PredatorX. If the
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

// "When this vehicle is played, pick one SS ship in hand and reduce its cost
// by 75k." Excalibur's mechanism exactly — DP6's hand direction
// (PLAY_CARD_TARGETING_CARD_IN_HAND): Victoria deploys to her zone first, then
// this fires against the hand target, and she is not spendCard'd because she is
// a hull, not a spent ability.
//
// The 2026-08-30 pass replaced Victoria's draw-on-death with an activated
// ability; this pass replaces THAT with an on-play effect, which orphans
// `victoriaActivate` below (spec §5). It stays registered and its name may
// never be reused.
registerEffect('victoriaOnPlay', costDelta({
  delta: VICTORIA_COST_DELTA,
  filter: SS_SHIP_FILTER,
}))

// "Each turn you may spend 200k resources to spawn another victoria into this
// zone." DP1 with a MATERIAL price rather than a CP one (spec §7.3, wave 6):
// ACTIVATE_VEHICLE charges meta.activateMaterialCost and stamps
// activatedOnTurn before this runs, so "each turn" needs no code here.
//
// The zone is re-derived from the hull rather than read off
// payload.targetZoneId, which ACTIVATE_VEHICLE fills from the CLIENT-supplied
// action.zoneId — Braveheart's precedent, and the reason it matters: a stale
// or malicious client could otherwise land the spawn in a zone Victoria is
// not in.
//
// Spawning is not playing (spec §7.4), so the new hull keeps its printed meta
// and can be activated in its own right. That chain is per-hull and
// per-turn, and every link costs a further 200k against income that is SET
// each turn — a hard bound, unlike Trebuchet's free repeat.
//
// Orphaned by the 2026-09-02 pass, which replaced this activated ability with
// `victoriaOnPlay`. Kept registered for `rheaOnPlay`'s reason, one entry down;
// see `DELIBERATE_ORPHANS`.
registerEffect('victoriaActivate', ({ game, actor, ctx, card }) => {
  const self = findVehicle(game.state, card.instanceId)
  if (!self || self.side !== actor) return false
  const snapshot = catalogCard(ctx, 'Victoria')
  // A named card the catalog cannot supply is a data bug, not an empty pool.
  if (!snapshot || !poolEligible(snapshot)) return false
  if (!spawnInto(game, ctx, actor, self.zone.id, snapshot)) return false
  game.state.log.push(`Victoria commissions another hull in zone ${self.zone.id}`)
  return true
}, { needsCatalog: true })

const BRAVEHEART = 'braveheartActivate'

// "Once per turn, you may pay 1cp to have one of your ships in this zone 1v1
// an enemy vehicle in the same zone."
//
// TWO HOPS since the 2026-09-02 pass (the card used to send Braveheart itself),
// and BOTH routed through choice() — TG Duel's shape, not Orbit Flank's. Orbit
// Flank writes its second pendingEffect by hand, which bypasses choice()'s
// one-slot check and can clobber an offer already owed;
// docs/claude/card-effects.md says to route a new suspension through choice().
// RESOLVE_PENDING_EFFECT has already nulled state.pendingEffect by the time hop
// 2 runs, so the slot is free for it to take.
//
// DP1 (ACTIVATE_VEHICLE pays the 1cp and stamps activatedOnTurn BEFORE this ever
// runs, so once-per-turn is free here) + DP4 (two choices) + DP3
// (declareForcedBattle, no summons, and NO activatesZone — a forced battle is
// not a zone activation; Eclipse alone is, from its own text).
//
// The zone is re-derived from payload.card on EVERY entry via findVehicle:
// payload.card is the activating hull itself, carried verbatim across each
// suspension, so nothing needs the client-supplied, unvalidated
// resolution.zoneId / targetInstanceId.
function braveheartZone(game: EngineGame, actor: Side, card: { instanceId: string }) {
  const found = findVehicle(game.state, card.instanceId)
  return found && found.side === actor ? found : null
}

// ⚠ Ruling E-10, borrowed from TG Duel and refined for Braveheart's own
// printed text: the pick must be a SHIP ("one of your ships") that can
// attack — INOFFENSIVE is precisely "cannot attack" (§7.3's Gang Up ruling).
// The ENEMY target is deliberately unfiltered — Inoffensive can still defend.
const canDuel = (e: ZoneCardEntry) =>
  e.vehicleType === VEHICLE_TYPES.SHIP && !e.keywords.includes(KEYWORDS.INOFFENSIVE)

// Whether Braveheart's own zone currently holds both a legal fighter (a ship
// that canDuel) and a legal enemy target — checked ONCE, before hop 1 ever
// suspends. Only the acting player can act while a choice is owed (only
// PENDING_ACTIONS reach a suspended effect), so neither pool can shrink
// between hop 1's offer and hop 2's resolve: checking here is exhaustive, not
// just a first guess. This is what lets the activation be REFUSED outright —
// ACTIVATE_VEHICLE 400s and the mutated clone is discarded, so the 1cp is
// never spent and activatedOnTurn is never stamped — rather than charging the
// player and then fizzling, which would be a pure loss for them.
function braveheartCanDuel(game: EngineGame, actor: Side, card: { instanceId: string }): boolean {
  const self = braveheartZone(game, actor, card)
  if (!self) return false
  if (enemyVehicleOptions(game, actor, self.zone.id).length === 0) return false
  if (friendlyVehicleOptions(game, actor, self.zone.id, canDuel).length === 0) return false
  return true
}

const braveheartHop2 = (fighterId: string): EffectFn => choice({
  effect: BRAVEHEART,
  prompt: 'Choose an enemy vehicle for it to fight',
  options: ({ game, actor, card }) => {
    const self = braveheartZone(game, actor, card)
    return self ? enemyVehicleOptions(game, actor, self.zone.id) : []
  },
  data: () => ({ fighterId }),
  resolve: (payload, enemyId) => {
    const { game, actor, card, ctx } = payload
    // Unreachable through normal dispatch — braveheartCanDuel already refused
    // the activation outright when the zone holds no enemy. Kept as a
    // defensive backstop, not a live path.
    if (enemyId === null) {
      game.state.log.push(`${card.name} finds no enemy vehicle in the zone`)
      return true
    }
    const self = braveheartZone(game, actor, card)
    // Every `return false` below leaves the choice standing rather than
    // failing the action outright — a refused resolve does not clear
    // state.pendingEffect, so the offer is still there; RESOLVE_PENDING_EFFECT
    // { cancel: true } is the player's way out of it.
    if (!self) return false
    // Both halves re-checked against the CURRENT board — either hull may have
    // left, or the fighter may have gained INOFFENSIVE, while the dialog sat
    // open (an enemy TG Hysteria grants it).
    const fighter = findVehicle(game.state, fighterId)
    if (!fighter || fighter.side !== actor || fighter.zone.id !== self.zone.id) return false
    if (!canDuel(fighter.entry)) return false
    if (!enemyVehicleOptions(game, actor, self.zone.id).some((o) => o.id === enemyId)) return false
    return declareForcedBattle(game, ctx, {
      zoneId: self.zone.id,
      aggressor: actor,
      attackerIds: [fighterId],
      defenderIds: [enemyId],
      cause: card.name,
    })
  },
})

const braveheartHop1: EffectFn = choice({
  effect: BRAVEHEART,
  prompt: 'Choose one of your ships to send into the duel',
  options: ({ game, actor, card }) => {
    const self = braveheartZone(game, actor, card)
    return self ? friendlyVehicleOptions(game, actor, self.zone.id, canDuel) : []
  },
  resolve: (payload, fighterId) => {
    // Unreachable through normal dispatch — braveheartCanDuel already refused
    // the activation outright when the zone holds no eligible ship. Kept as a
    // defensive backstop, not a live path.
    if (fighterId === null) {
      payload.game.state.log.push(`${payload.card.name} finds no ship to send`)
      return true
    }
    // Hop 2's first entry: `resolution` cleared so choice() takes the slot
    // again, `pending` cleared so it cannot be mistaken for hop 2's own.
    return braveheartHop2(fighterId)({ ...payload, resolution: undefined, pending: undefined })
  },
})

// The router. Hop 2 is told apart by the fighterId hop 1 stashed — never by
// anything the client sent. Before EVER calling hop 1 — its first entry, or
// its own re-entry on resolve — the zone must hold a legal duel; see
// braveheartCanDuel.
registerEffect(BRAVEHEART, (payload) => {
  const stashed = payload.pending?.data?.fighterId
  if (typeof stashed === 'string') return braveheartHop2(stashed)(payload)
  if (!braveheartCanDuel(payload.game, payload.actor, payload.card)) return false
  return braveheartHop1(payload)
})

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
// into the zone under your control." The reinforcement TAKES PART in the
// battle that summoned it, and is kept if it survives it.
//
// That pair of requirements is why this is a BOARD spawn joined by id rather
// than the battle summon The Onyx Throne uses. A summon lives only inside
// ActiveBattle.summons and evaporates on report approval whatever its HP
// (battleResolve.ts) — which would make "spawn another dryad into the zone"
// hand back nothing. So: spawnInto puts the hull in zone.cards, then
// joinBattle WITHOUT an entry adds only its id to the defending side. Being a
// real board vehicle is what earns it the ordinary outcomes — destroyed and
// discarded when it dies, still standing in the zone when it lives.
//
// ⚠ This was originally a bystander spawn with no joinBattle at all, so the
// Dryad fought alone and its replacement appeared beside the corpse. Do not
// "restore" that by dropping the join.
//
// It carries the same trigger, so it will spawn again in a later defensive
// battle it takes part in. That compounding is the card; nothing here caps it.
// Within ONE lock it cannot re-trigger, because the dispatch walks a roster
// snapshotted before any effect runs (battleTriggers.ts) — so the hull this
// adds to defenderIds is never dispatched by the lock that added it.
registerEffect('dryadBattle', ({ game, actor, ctx, battle }) => {
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant || !battle.isDefender) return true
  const snapshot = catalogCard(ctx, 'Dryad')
  // Deliberately NOT poolEligible-gated, unlike balmungOnPlay and
  // victoriaActivate's by-name mints (docs/claude/architecture.md). Dryad is
  // one of the five cards the 2026-09-02 pass retired (spec §2.1) — a
  // poolEligible(snapshot) check would now read false and this spawn would
  // silently stop mid-battle in every one of the 28 games that already have a
  // Dryad on the board. Retirement gates DRAFTING and DRAW POOLS; it does not
  // reach back into a board effect resolving a battle in a game already
  // dealt. Do not add the check here.
  //
  // A card missing from the catalog is a data bug, not an empty pool — the
  // same contract spawnVehicles and summonHulls both use.
  if (!snapshot) return false
  // battle.zoneId, not the spawning Dryad's own zone: joinBattle's on-board
  // check is scoped to the battle's zone, so a hull spawned anywhere else
  // could not join. The two differ only for a cross-zone duel (wave 7).
  const grown = spawnInto(game, ctx, actor, battle.zoneId, snapshot)
  if (!grown) return false
  if (!joinBattle(game, actor, grown.instanceId)) return false
  game.state.log.push(`Another Dryad takes root in zone ${battle.zoneId} and joins the defence`)
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

const BLOCKADE = 'blockadeEffect'

// "Choose a zone, whenever the opponent plays a vehicle into that zone while
// you have at least one vehicle there, a fleet battle immediately begins in
// that zone. If you lose with no surviving vehicles, the blockade goes away,
// otherwise it remains."
//
// DP7's only customer (spec §4.3, "DP7 as wave 6 built it"). Three clauses
// behind ONE registry name, told apart by the payload — the DWG Waters shape,
// and it must stay one name because the zoneEffects entry stores the name it
// was claimed under, and that is what dispatches the rider once the ability
// itself has been spent.
//
//   clause 1  no battle, no continuation  → claim the zone (permanently)
//   clause 2  battle.phase === 'deploy'   → spring the trap
//   clause 3  continuation                → keep or break the blockade
//
// { needsCatalog: true } is NOT about this effect's own needs — it reads no
// catalog at all. fireRider mints the rider's payload card from ctx.catalog by
// cardName, so without the flag game-action never loads one and the blockade
// is silently skipped in production while every unit test passes.
function blockadeClaim({ game, actor, card, targetZoneId }: EffectPayload): boolean {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  if (!zone) return false
  // A second blockade on a zone you already hold one in buys nothing — refuse
  // before the handler commits, so the play is not spent on a no-op (the
  // ambushClaim and dwgWatersClaim precedent). The OPPONENT may still claim
  // the same zone; the two riders are independent.
  const held = game.state.zoneEffects.some(
    (e) => e.effect === BLOCKADE && e.zoneId === targetZoneId && e.side === actor,
  )
  if (held) return false
  game.state.zoneEffects.push({
    // Permanent — no expiresOnTurn. "Otherwise it remains" is the card's own
    // word for it, and clause 3 is the only thing that removes it.
    effect: BLOCKADE, zoneId: targetZoneId, side: actor, cardName: card.name,
    setOnTurn: game.turnNumber,
  })
  game.state.log.push(`Player ${actor.toUpperCase()} blockades zone ${targetZoneId}`)
  return true
}

// Clause 2. `actor` here is the RIDER's side — fireRider dispatches with
// rider.side — so the blockader is the aggressor, which is what every other
// forced battle in the codebase does with the effect's owner (spec §7.3,
// wave 6). DWG Waters' clause 3 is the one inversion, and it inverts because
// the enemy's action there was already an attack; a deploy is not.
function blockadeSpring(payload: EffectPayload): boolean {
  const { game, actor, ctx, card, battle } = payload
  // Its own battle's lock pass re-enters this rider a moment after it
  // declares — dispatchBattleLock iterates every rider on the zone. Anything
  // but 'deploy' is a no-op, which is what stops the recursion.
  if (!battle || battle.phase !== 'deploy') return true
  // NOTE: there is deliberately no `if (game.state.activeBattle) return true`
  // here. dispatchDeployWatchers already stops its pass at the first battle
  // declared, and a second guard on the same condition made THAT one
  // unobservable — a surviving mutation is what exposed it. One guard, in the
  // dispatcher, where it generalises to any future deploy watcher.
  const zone = zoneById(game.state, battle.zoneId)
  if (!zone) return true
  const mine = zone.cards[actor] as ZoneCardEntry[]
  const theirs = zone.cards[otherSide(actor)] as ZoneCardEntry[]
  // "A FLEET battle begins in that zone": everything on both sides, not just
  // the hull that walked in. The aggressor's force excludes Inoffensive hulls
  // (spec §7.3's Gang Up ruling — Inoffensive is precisely "cannot attack",
  // and a forced battle is not a licence to break it); the defender's side
  // keeps its own, because Inoffensive says nothing about being attacked.
  const attackerIds = mine
    .filter((c) => !c.keywords.includes(KEYWORDS.INOFFENSIVE))
    .map((c) => c.instanceId)
  const defenderIds = theirs.map((c) => c.instanceId)
  // One check covers both readings, and a separate `mine.length === 0` test
  // above it was a line no test could distinguish from its absence (another
  // surviving mutation): "while you have at least one vehicle there" fails
  // when the fleet is empty, and Gang Up's rule fails when every hull in it is
  // Inoffensive. Either way the trap does not spring — and is NOT spent
  // either: the card removes it on a loss and on nothing else.
  if (attackerIds.length === 0 || defenderIds.length === 0) return true
  return declareForcedBattle(game, ctx, {
    zoneId: battle.zoneId,
    aggressor: actor,
    attackerIds,
    defenderIds,
    // The removal condition needs the battle's OUTCOME, which does not exist
    // until DECIDE_BATTLE_REPORT — exactly what continuation is for (spec
    // §4.3, departure 3). zoneId is stashed because activeBattle is already
    // null by the time clause 3 runs.
    continuation: { effect: BLOCKADE, side: actor, card, data: { zoneId: battle.zoneId } },
    cause: card.name,
    // No activatesZone: a forced battle is not a zone activation (spec §4.3).
  })
}

// Clause 3. "If you lose with no surviving vehicles, the blockade goes away,
// otherwise it remains."
//
// Read off the POST-RESOLUTION board rather than off the outcome, which §7.3's
// Trebuchet ruling already blesses ("read off the post-resolution state, which
// needs no outcome plumbing on the payload"). It is also the only route that
// works: contextForResolve hands a continuation `won` for its OWN side, which
// means "the enemy has no survivors" — the opposite of what this clause asks —
// and `survived` is meaningless for an ability card that was never a
// participant. Since clause 2 drags in every eligible hull, "no vehicles left
// in the zone" and "lost with no surviving vehicles" are the same statement.
//
// This is NOT wave 4's mistake: that was re-deriving a win from a roster
// stashed at DECLARE time, which a late joiner made stale. The current board
// cannot go stale.
function blockadeAftermath({ game, actor, continuation }: EffectPayload): boolean {
  // The type guard is load-bearing for TYPESCRIPT (data is
  // Record<string, unknown>) and, a surviving mutation showed, for nothing
  // else: zoneById(undefined) already returns undefined and the next line
  // refuses. Keep it; it is what makes the value a number below.
  const zoneId = continuation?.data?.zoneId
  if (typeof zoneId !== 'number') return false
  const zone = zoneById(game.state, zoneId)
  if (!zone) return false
  if (zone.cards[actor].length > 0) return true
  game.state.zoneEffects = game.state.zoneEffects.filter(
    (e) => !(e.effect === BLOCKADE && e.zoneId === zoneId && e.side === actor),
  )
  game.state.log.push(`The blockade of zone ${zoneId} is broken`)
  return true
}

registerEffect(BLOCKADE, (payload) => {
  // Checked first: a continuation carries a 'resolve' BattleContext, and only
  // `continuation` tells it apart from an ordinary resolve trigger.
  if (payload.continuation !== undefined) return blockadeAftermath(payload)
  // Nothing here ever suspends, so a resolution can only be someone else's.
  if (payload.resolution !== undefined) return true
  if (payload.battle) return blockadeSpring(payload)
  return blockadeClaim(payload)
}, { needsCatalog: true, deployWatcher: true })

// "This card costs 60k less for every turn it spends in your hand."
//
// The residence stamp is written by putInHand (spec §4.2) and re-written every
// time the card re-enters a hand, so a Tyr that was played, died, reshuffled
// and was drawn again starts its count over — which is what "spends in your
// hand" says.
//
// ⚠ An UNSTAMPED card is not a bug to assert on, it is the ordinary state of
// every hand dealt before this deploys: hands live in game_players rows and
// normalizeState cannot reach them (it takes a PublicGameState). So a missing
// or non-finite stamp returns 0 — `turnNumber - undefined` is NaN, a NaN
// modifier makes effectiveCostInGame NaN, and that reads as unaffordable at
// every check AND writes NaN into the payer's materials at pay().
//
// Math.max(0, …) is on the STEP COUNT, not on the price. The price floor is
// effectiveCostInGame's own Math.max(0, …) and must not be duplicated here
// (spec §4.2); this clamp is a different guarantee — a card whose stamp is
// somehow in the future must not cost MORE.
registerCostModifier('tyrCostModifier', (_state, _side, card, turnNumber) => {
  const entered = card.handEnteredTurn
  if (typeof entered !== 'number' || !Number.isFinite(entered)) return 0
  return -TYR_HAND_DISCOUNT * Math.max(0, Math.floor(turnNumber - entered))
})

// "Whenever this survives an offensive fleet battle, deal 200k damage to enemy
// base in this zone." vengefulBattle (tgEffects.ts) is the worked example,
// including the checkVictory call — this is a route to a base reaching 0 that
// ATTACK_ENEMY_BASE's own call cannot cover.
//
// ⚠ THE 'baseAttack' GATE IS LOAD-BEARING. ON_BATTLE_VICTORY is dispatched
// from TWO places: dispatchBattleResolve (a real battle) and
// dispatchBaseAttackVictory (a bombardment, phase 'baseAttack' — Plunderer's
// other half, spec §4.3 DP2 departure 5). A bombardment is not a fleet battle,
// so without `phase === 'resolve'` this would add 200 HP to every base attack
// Bull Shark took part in.
//
// `!isDefender` is the word "offensive". `won` needs no gate: this key is
// dispatched only for the side that won.
registerEffect('bullSharkVictory', ({ game, actor, card, battle }) => {
  if (!battle || battle.phase !== 'resolve') return true
  if (battle.isDefender || !battle.survived) return true
  const found = findVehicle(game.state, card.instanceId)
  // A hull that is off the board has no zone to strike from. `participants`
  // still holds a destroyed entry at resolve (ruling E-2b), and while
  // `survived` already excludes that case, the board is the authority on where
  // the damage lands.
  if (!found || found.side !== actor) return true
  const enemy = otherSide(actor)
  const damage = Math.floor(BULL_SHARK_BASE_DAMAGE / BASE_DAMAGE_DIVISOR)
  found.zone.baseHp[enemy] = Math.max(0, found.zone.baseHp[enemy] - damage)
  game.state.log.push(
    `${card.name} shells the enemy base in zone ${found.zone.id} for ${damage} (${found.zone.baseHp[enemy]} HP remains)`,
  )
  if (found.zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${found.zone.id} has fallen`)
  checkVictory(game)
  return true
})

// "Gain 150k resources this turn, then draw a card."
//
// One grant rather than a sequence: grant() draws BEFORE it adds materials, and
// nothing in a draw reads materials, so the printed order is unobservable. Its
// own registry id rather than a reuse of ransackOnPlay's draw-plus-CP shape —
// this grants materials, not CP, and R-6 forbids sharing a name regardless.
registerEffect('cashAdvanceEffect', grant({ materials: CASH_ADVANCE_MATERIALS, draw: 1 }))
