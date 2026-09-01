import { TRIGGERS } from '../gameSettings.ts'
import type { CardInstance, SnapshotCard, ZoneEffect } from './gameInit.ts'
import type {
  BattleCasualty, BattleContext, EngineContext, EngineGame, Side, ZoneCardEntry,
} from './engineTypes.ts'
import {
  discardCard, discardSnapshotOf, findVehicle, otherSide, zoneById,
} from './gameEngine.ts'
import {
  BYSTANDER_EFFECTS, DEPLOY_WATCHER_EFFECTS, RESOLVE_BYSTANDER_EFFECTS, effectFor, effectName,
} from '../effects/registry.ts'

// DP2 (spec §4.3, and its seven "DP2 departure" subsections). This module owns
// the whole battle-trigger dispatch and registers no handler of its own: the
// three seams that call it are battleDeclare.ts (lock), battleResolve.ts
// (resolve) and baseAttack.ts (bombardment).
//
// Unlike every dispatch point before it, DP2's three keys were named on zero
// seeded cards when wave 4 opened, so the wave authored the dispatch and the
// seed data together.

// The per-entry meta key a Havoc/Mirth Factory stamps onto its target (wave
// 7). Deliberately OUTSIDE TRIGGERS, so G3 never inspects it and HandBar needs
// no change; its VALUE is the Factory effect's own registry name, which is what
// makes the game-action catalog probe load a catalog for it — that probe scans
// every meta value for a CATALOG_EFFECTS member regardless of key, and the
// Factory card itself was spent turns ago.
//
// ⚠ It is a per-instance stamp, so it MUST be named in discardSnapshotOf's
// strip list — see the comment there.
export const FACTORY_ESCORT_KEY = 'factoryEscort'

export interface BattleParticipant { entry: ZoneCardEntry; side: Side }
export interface BattleOutcome { wonBy: Record<Side, boolean>; survived: Set<string> }

// A side wins when the enemy has no surviving participant (spec §4.3's DP2
// row); both false is a draw, which the callers read off two booleans rather
// than a third flag. Summons count as participants here (DP2 departure 6):
// they fought, so a surviving Martyr denies its enemy the win even though it
// evaporates a moment later.
export function battleOutcome(
  participants: Map<string, BattleParticipant>,
  survivingIds: Set<string>,
  aggressor: Side,
): BattleOutcome {
  const defender = otherSide(aggressor)
  const anySurvivor = (side: Side) =>
    [...participants.values()].some((p) => p.side === side && survivingIds.has(p.entry.instanceId))
  return {
    wonBy: {
      [aggressor]: !anySurvivor(defender),
      [defender]: !anySurvivor(aggressor),
    } as Record<Side, boolean>,
    survived: survivingIds,
  }
}

// One dispatch. EVERY trigger runs, even when a choice is already owed: the
// one-slot rule is enforced inside choice() (primitives.ts), which drops a
// second OFFER rather than skipping a whole effect (spec §4.3, DP2 departure
// 4). Enforcing it here instead would starve an unconditional clause sharing a
// card with an optional one — two surviving Sacrilegos would grant 1 CP
// between them rather than 1 each.
//
// A trigger that reports failure gets a log note and nothing more: at lock the
// battle is already declared, and at resolve the report is already approved,
// so neither can be rolled back over it — the same treatment onDeathEffect has
// had since wave 3.
function fire(
  game: EngineGame, ctx: EngineContext,
  card: CardInstance, actor: Side, triggerKey: string, battle: BattleContext,
): void {
  const name = effectName(card, triggerKey)
  if (name === null) return
  const fn = effectFor(name)
  if (!fn) return
  if (!fn({ game, actor, card, ctx, battle })) {
    game.state.log.push(`${card.name}'s battle trigger could not resolve`)
  }
}

// The participant roster, in the fixed order every dispatch walks: attackers in
// attackerIds order, then defenders in defenderIds order. A summon carries no
// side field — membership in one of those two lists decides it (spec §4.4) —
// so the zone lookup falls back to the summon map exactly as participantsOf
// does in battleResolve.ts.
function lockRoster(game: EngineGame): BattleParticipant[] {
  const battle = game.state.activeBattle!
  const zone = zoneById(game.state, battle.zoneId)
  if (!zone) return []
  const summons = new Map(battle.summons.map((s) => [s.instanceId, s as ZoneCardEntry]))
  const roster: BattleParticipant[] = []
  const collect = (ids: string[], side: Side) => {
    for (const id of ids) {
      // Zone first, then the summon map, then BOARD-WIDE (wave 7): a
      // cross-zone battle's away hull is on the board but not in this zone,
      // and without the last fallback its DP2 lock triggers never fire. The
      // side check keeps it exact — an id is only ever collected for the side
      // whose list named it.
      const away = findVehicle(game.state, id)
      const entry = (zone.cards[side] as ZoneCardEntry[]).find((c) => c.instanceId === id) ??
        summons.get(id) ??
        (away?.side === side ? away.entry : undefined)
      if (entry) roster.push({ entry, side })
    }
  }
  collect(battle.attackerIds, battle.aggressor)
  collect(battle.defenderIds, otherSide(battle.aggressor))
  return roster
}

// Fires at battle lock, from lockBattle (forced: false) and
// declareForcedBattle (forced: true). Three sources, in this order (spec §4.3,
// DP2 departure 2):
//
//   1. every participant on both sides, summons included;
//   2. ONLY on a forced battle, the defending side's non-participants in that
//      zone whose onBattleEffect is registered { battleBystander: true };
//   3. state.zoneEffects riders on that zone, BOTH sides (DP2 departure 8).
//
// The PARTICIPANT roster is snapshotted before anything runs, so an effect
// that adds a hull to the board (Dryad) or to the battle (The Onyx Throne)
// cannot trigger itself a second time within the same lock. The bystander list
// is built AFTER that pass, so a hull a participant trigger spawned is already
// on the board when it is filtered — harmless today, since Terawatt is the only
// bystander and nothing spawns one, but not the same guarantee.
export function dispatchBattleLock(game: EngineGame, ctx: EngineContext, forced: boolean): void {
  const battle = game.state.activeBattle
  if (!battle) return
  const zone = zoneById(game.state, battle.zoneId)
  if (!zone) return
  const defenderSide = otherSide(battle.aggressor)
  const context = (isDefender: boolean, isParticipant: boolean): BattleContext => ({
    phase: 'lock', zoneId: battle.zoneId, isDefender, isParticipant, forced,
    survived: false, won: false, casualties: [],
  })

  for (const { entry, side } of lockRoster(game)) {
    const own = context(side !== battle.aggressor, true)
    fire(game, ctx, entry, side, TRIGGERS.ON_BATTLE_EFFECT, own)
    // Wave 7's per-HULL rider (spec §4.4). state.zoneEffects is per-ZONE, so
    // the Factories stamp their own registry name onto the targeted hull under
    // meta.factoryEscort, and it is dispatched here by the same `fire` — a
    // custom meta key rather than a TRIGGERS one, which is the whole of what
    // lets a hull carry BOTH its own printed battle trigger and an escort.
    // (The handoff's alternative — overwriting onBattleEffect — would have had
    // to refuse a target that already carried one, and could never have been
    // stripped in discardSnapshotOf, because Obelisk and Horror carry that key
    // as card data.)
    fire(game, ctx, entry, side, FACTORY_ESCORT_KEY, own)
  }

  if (forced) {
    const inBattle = new Set([...battle.attackerIds, ...battle.defenderIds])
    // Snapshotted: a bystander that joins the battle (Terawatt) must not then
    // be revisited by this same loop as a non-participant.
    const bystanders = (zone.cards[defenderSide] as ZoneCardEntry[]).filter((entry) => {
      if (inBattle.has(entry.instanceId)) return false
      const name = effectName(entry, TRIGGERS.ON_BATTLE_EFFECT)
      return name !== null && BYSTANDER_EFFECTS.has(name)
    })
    for (const entry of bystanders) {
      fire(game, ctx, entry, defenderSide, TRIGGERS.ON_BATTLE_EFFECT, context(true, false))
    }
  }

  // A spent ability keeps firing through state.zoneEffects (decision 22).
  //
  // BOTH sides, since wave 5 (spec §4.3, DP2 departure 8). Wave 4 scanned the
  // defender's riders only, because DWG Waters was the only customer and it
  // reacts to being attacked; Ambush and Ongoing Attrition fire on a battle
  // their own owner declares, which a defender-only pass can never reach.
  // Each rider now reads its own isDefender and self-selects, exactly as
  // dwgWatersDefensiveGuest already did.
  // Snapshotted, like the participant roster above and for the same reason:
  // a rider may remove ITSELF as it fires (Ambush is spent by the battle,
  // Ongoing Attrition by its damage), and one that added an entry must not
  // then be dispatched inside the same lock.
  for (const rider of [...game.state.zoneEffects]) {
    if (rider.zoneId !== battle.zoneId) continue
    fireRider(game, ctx, rider, context(rider.side !== battle.aggressor, false))
  }
}

// One zone-effect rider, dispatched by the registry name its entry stores
// rather than through a meta key — its card was spent turns (or a whole game)
// ago, so it is in no hand and on no field. The payload card is minted from
// the catalog by `cardName`, which is why a rider effect needs
// `{ needsCatalog: true }` EVEN IF it never reads the catalog itself: without
// the flag `game-action` never loads one, the lookup below fails, and the
// rider is skipped in production while every unit test passes.
//
// A cardName the catalog cannot supply is a data problem, not a game-stopping
// one: skip rather than fail an action that has already committed.
function fireRider(
  game: EngineGame, ctx: EngineContext, rider: ZoneEffect, battle: BattleContext,
): void {
  const fn = effectFor(rider.effect)
  if (!fn) return
  const snapshot = ctx.catalog.find((c) => c.isBuiltIn && c.name === rider.cardName)
  if (!snapshot) return
  const card: CardInstance = { ...snapshot, instanceId: ctx.newId() }
  if (!fn({ game, actor: rider.side, card, ctx, battle })) {
    game.state.log.push(`${rider.cardName}'s zone effect could not resolve`)
  }
}

// DP7 (spec §4.3, "DP7 as wave 6 built it"). Fires when the OPPONENT plays a
// vehicle into a zone this side's rider watches — the first dispatch that
// hangs off a PLAY rather than off a battle, a bombardment or the turn end.
// Called from BOTH `PLAY_CARD_TO_ZONE` and `PLAY_CARD_TARGETING_CARD_IN_HAND`,
// the two handlers that share deployVehicle; a dispatch added to only one is a
// card that works until someone plays Excalibur.
//
// Two things make it narrow on purpose:
//
//   * `rider.side === actor` is skipped — the card says "whenever the OPPONENT
//     plays a vehicle into that zone", so a reinforcement of your own is not a
//     trespass.
//   * only DEPLOY_WATCHER_EFFECTS members are dispatched, so no other rider
//     ever meets a phase it was not written for. dwgWatersEffect's router
//     falls through to its claim branch on an unrecognised phase, so a
//     broadcast would make it attempt a claim with no target zone and log a
//     spurious failure on every enemy deploy into a zone it holds.
//
// `isDefender: true` because the rider's owner is by construction not the
// acting player. One battle per play: a rider that finds one already declared
// stops the pass, the same guard dispatchZoneInterception uses.
export function dispatchDeployWatchers(
  game: EngineGame, ctx: EngineContext, zoneId: number, actor: Side,
): void {
  const context: BattleContext = {
    phase: 'deploy', zoneId, isDefender: true, isParticipant: false,
    forced: false, survived: false, won: false, casualties: [],
  }
  for (const rider of [...game.state.zoneEffects]) {
    if (rider.zoneId !== zoneId || rider.side === actor) continue
    if (!DEPLOY_WATCHER_EFFECTS.has(rider.effect)) continue
    if (game.state.activeBattle) return
    fireRider(game, ctx, rider, context)
  }
}

// The mirror of dispatchZoneInterception (below): the riders belonging to the
// side that just ACTIVATED a zone with a bombardment (spec §4.3, DP2
// departure 9). Ongoing Attrition is the only customer — "if that zone is
// activated, and you are attacking…" — and the interception pass, which scans
// the defender, can never reach it.
//
// `isDefender: false` is what keeps the two apart: dwgWatersInterception
// guards on it, so a claim-holder bombarding a zone they hold does not
// intercept their own attack.
export function dispatchZoneActivation(
  game: EngineGame, ctx: EngineContext, zoneId: number, actor: Side,
): void {
  const context: BattleContext = {
    phase: 'baseAttack', zoneId, isDefender: false, isParticipant: false,
    forced: false, survived: false, won: false, casualties: [],
  }
  for (const rider of [...game.state.zoneEffects]) {
    if (rider.zoneId !== zoneId || rider.side !== actor) continue
    fireRider(game, ctx, rider, context)
  }
}

// Fires from DECIDE_BATTLE_REPORT, after the death triggers and before the
// continuation. activeBattle is already null by then — it is nulled before
// either — so the battle's identity arrives as arguments rather than being
// read back off state.
export function dispatchBattleResolve(
  game: EngineGame, ctx: EngineContext,
  zoneId: number, aggressor: Side,
  participants: Map<string, BattleParticipant>, outcome: BattleOutcome,
  casualties: BattleCasualty[],
): void {
  for (const { entry, side } of participants.values()) {
    const context: BattleContext = {
      phase: 'resolve', zoneId, isDefender: side !== aggressor, isParticipant: true,
      forced: false,
      survived: outcome.survived.has(entry.instanceId),
      won: outcome.wonBy[side],
      casualties,
    }
    fire(game, ctx, entry, side, TRIGGERS.ON_BATTLE_EFFECT, context)
    const sugar = outcome.wonBy[side]
      ? TRIGGERS.ON_BATTLE_VICTORY
      : outcome.wonBy[otherSide(side)] ? TRIGGERS.ON_BATTLE_DEFEAT : null
    if (sugar) fire(game, ctx, entry, side, sugar, context)
  }

  // DP8 (spec §4.3, "DP8 as wave 7 built it"). The second half of DP2
  // departure 2: a hull that reacts to a battle it is NOT in, at RESOLVE.
  //
  // dispatchBattleLock's bystander pass cannot serve it — that one fires only
  // at lock, only on a forced battle, only for the defending side, and only in
  // the battle's own zone. TG Vengeful's "whenever you lose a vehicle to a
  // fleet battle (ANY zone)" needs all four widened at once.
  //
  // Snapshotted before dispatching, exactly as the lock pass is and for the
  // same reason: an effect that puts a hull on the board must not then be
  // reached by this same loop.
  //
  // Membership in RESOLVE_BYSTANDER_EFFECTS is the whole gate. Broadcasting
  // would hand dwgWatersEffect a context its router does not recognise, and it
  // falls through to its claim branch — a spurious claim attempt with no
  // target zone on every battle in the game.
  const bystanders: { entry: ZoneCardEntry; side: Side }[] = []
  for (const zone of game.state.zones) {
    for (const side of ['a', 'b'] as Side[]) {
      for (const entry of zone.cards[side] as ZoneCardEntry[]) {
        if (participants.has(entry.instanceId)) continue
        const name = effectName(entry, TRIGGERS.ON_BATTLE_EFFECT)
        if (name !== null && RESOLVE_BYSTANDER_EFFECTS.has(name)) bystanders.push({ entry, side })
      }
    }
  }
  for (const { entry, side } of bystanders) {
    fire(game, ctx, entry, side, TRIGGERS.ON_BATTLE_EFFECT, {
      // zoneId is the BATTLE's, not the bystander's — an effect that needs its
      // own re-derives it with findVehicle, the way Braveheart does.
      phase: 'resolve', zoneId, isDefender: side !== aggressor, isParticipant: false,
      forced: false, survived: false, won: outcome.wonBy[side], casualties,
    })
  }
}

// A bombardment is not a battle, but it is the other half of Plunderer's one
// clause (spec §4.3, DP2 departure 5), so ATTACK_ENEMY_BASE dispatches the
// victory key to exactly the hulls that dealt the damage — baseStrikersIn's
// roster, not everything standing in the zone.
// The resolve-phase context for one named hull. Exported so
// DECIDE_BATTLE_REPORT can hand the SAME outcome to a battle continuation that
// it hands to the resolve triggers — Trebuchet used to re-derive its own win
// from a roster snapshotted at declare time, which a defender joining
// afterwards (Terawatt) made stale, handing it a free repeat off a battle it
// had actually lost.
export function contextForResolve(spec: {
  zoneId: number; aggressor: Side; side: Side; instanceId: string
  participants: Map<string, BattleParticipant>; outcome: BattleOutcome
  casualties: BattleCasualty[]
}): BattleContext {
  return {
    phase: 'resolve', zoneId: spec.zoneId,
    isDefender: spec.side !== spec.aggressor,
    isParticipant: spec.participants.has(spec.instanceId),
    forced: false,
    survived: spec.outcome.survived.has(spec.instanceId),
    won: spec.outcome.wonBy[spec.side],
    casualties: spec.casualties,
  }
}

export function dispatchBaseAttackVictory(
  game: EngineGame, ctx: EngineContext,
  zoneId: number, actor: Side, strikers: ZoneCardEntry[],
): void {
  const context: BattleContext = {
    phase: 'baseAttack', zoneId, isDefender: false, isParticipant: true,
    forced: false, survived: true, won: true, casualties: [],
  }
  for (const entry of strikers) {
    fire(game, ctx, entry, actor, TRIGGERS.ON_BATTLE_VICTORY, context)
  }
}

// A direct base attack, offered to the DEFENDER's zone-effect riders before
// any damage lands (spec §7.3). A rider may convert the bombardment into a
// battle — DWG Waters' clause 3 is the only one today — by declaring one; the
// caller reads `game.state.activeBattle` afterwards to find out whether that
// happened, which is why nothing is returned here.
//
// Automatic, not offered: a declinable interception would let the defender
// void the attacker's zone activation AND take no damage, which is the one
// shape of decline that harms the other player rather than only its own
// chooser (decision 25).
export function dispatchZoneInterception(
  game: EngineGame, ctx: EngineContext, zoneId: number, actor: Side,
): void {
  const defenderSide = otherSide(actor)
  const context: BattleContext = {
    phase: 'baseAttack', zoneId, isDefender: true, isParticipant: false,
    forced: false, survived: false, won: false, casualties: [],
  }
  for (const rider of [...game.state.zoneEffects]) {
    if (rider.zoneId !== zoneId || rider.side !== defenderSide) continue
    // One interception is enough: a battle already declared means the
    // bombardment is spent.
    if (game.state.activeBattle) return
    fireRider(game, ctx, rider, context)
  }
}

// One hull's onDeathEffect. Extracted in wave 5 so "destroy" means the same
// thing in both places that destroy: DECIDE_BATTLE_REPORT's resolution loop,
// and Recurring Threat's "choose a friendly vehicle, destroy it" (spec §7.3,
// decision 28 — a card that says "remove from play" instead, like Sub Killer,
// must NOT call this).
//
// An unimplemented name is skipped silently: its vanilla note already ran at
// play time (spec §3.9). A failing effect gets a log note and nothing more —
// the destruction has already happened and cannot be rolled back over it. A
// throw is still NOT caught, so death effects must return false on failure.
export function fireDeathEffect(
  game: EngineGame, ctx: EngineContext, side: Side, entry: ZoneCardEntry,
): void {
  const name = effectName(entry, TRIGGERS.ON_DEATH)
  if (name === null) return
  const fn = effectFor(name)
  if (!fn) return
  if (!fn({ game, actor: side, card: entry, ctx })) {
    game.state.log.push(`${entry.name}'s death effect could not resolve`)
  }
}

// Undo one death: put the hull back on the board and take its snapshot back
// out of the discard. Iron Cordon and Sacrilego's clause 2 are the two
// customers. The snapshot is matched on cardId alone — two copies of one card
// are byte-identical in the discard, so removing either is exact — and looked
// for under the card's OWNER (a captured hull's discard is filed there, not
// under whoever was flying it).
//
// Returns false without touching anything when the zone is gone or nothing
// matches, so a caller can refuse rather than half-apply. It does NOT unwind
// an onDeathEffect that already fired (spec §4.3, DP2 departure 7): both
// customers resolve a choice in a later action, by which time those have run.
// Two snapshots of one card are NOT interchangeable, however tempting that
// looks: keywords and meta are per-instance and diverge on the board.
// repairmenReadyEffect grants SCRAPPY to a hull already deployed, so a plain
// and a Scrappy Cyclone share a cardId and differ in exactly the field that
// matters — revive the wrong snapshot and the owner gets a free Scrappy copy
// back through reshuffleDiscard. So: an exact match first, falling back to
// cardId only when nothing matches exactly (a card whose stored snapshot has
// drifted for some reason still comes back rather than stranding the player).
//
// Field-by-field rather than JSON.stringify: jsonb does not preserve key
// order, so a stored snapshot's keys can come back in a different order than
// the one just rebuilt in memory.
function sameSnapshot(a: SnapshotCard, b: SnapshotCard): boolean {
  if (a.cardId !== b.cardId || a.name !== b.name || a.materialCost !== b.materialCost) return false
  if ([...a.keywords].sort().join('|') !== [...b.keywords].sort().join('|')) return false
  const metaOf = (m: Record<string, unknown>) =>
    Object.keys(m).sort().map((k) => `${k}=${JSON.stringify(m[k])}`).join('&')
  return metaOf(a.meta) === metaOf(b.meta)
}

function discardIndexOf(game: EngineGame, side: Side, entry: ZoneCardEntry): number {
  const pile = game.state.destroyed[side]
  const wanted = discardSnapshotOf(entry)
  const exact = pile.findIndex((c) => sameSnapshot(c, wanted))
  return exact >= 0 ? exact : pile.findIndex((c) => c.cardId === entry.cardId)
}

// Whether reviveEntry would succeed right now. Load-bearing rather than
// cosmetic: a death trigger dispatched EARLIER in the same
// DECIDE_BATTLE_REPORT can empty the pile out from under a casualty —
// ironMaidenOnDeath and friends are grant({ draw: 1 }), and drawCard on an
// empty deck calls reshuffleDiscard, which moves the WHOLE discard into the
// deck. Offering a hull that can no longer be revived leaves the player a
// choice whose only working answer is Decline.
export function canRevive(game: EngineGame, side: Side, entry: ZoneCardEntry): boolean {
  return discardIndexOf(game, side, entry) >= 0
}

export function reviveEntry(
  game: EngineGame, side: Side, entry: ZoneCardEntry, zoneId: number,
): boolean {
  const zone = zoneById(game.state, zoneId)
  if (!zone) return false
  const index = discardIndexOf(game, side, entry)
  if (index < 0) return false
  game.state.destroyed[side].splice(index, 1)
  zone.cards[side].push(entry)
  return true
}

// reviveEntry's sibling, and wave 7's answer to TG Nostalgia: "whenever this
// would be destroyed, put it back into your hand."
//
// The engine has no replacement effects. DECIDE_BATTLE_REPORT's resolution
// loop removes from zone.cards, calls discardCard and pushes to
// destroyedEntries, and only AFTERWARDS runs fireDeathEffect — so nothing can
// say "instead of". This UNDOES the discard rather than preventing it, which
// is why three consequences survive and are recorded in spec §7.3:
//
//   * the death is still logged;
//   * it still counts toward destroyedCount;
//   * it still counts as a LOSS for battleOutcome, because survivingIds is
//     computed before any trigger runs. So a lone Nostalgia losing a battle
//     still hands the enemy the win and still writes zone.lostBattleOnTurn,
//     which WF Purifier deploys off.
//
// The card goes to the CONTROLLER's hand — that is whose hand "your hand" is,
// and under the copy model it is the only pile involved. A fresh instanceId is
// minted because SnapshotCard carries none, exactly as reshuffleDiscard does.
//
// A CAPTURED copy can never come back this way, and needs no special case to
// stop it: discardCard destroys it instead of filing a snapshot, so
// discardIndexOf finds nothing and this returns false. A Nostalgia you copied
// off the enemy deck dies once and is gone.
//
// Returns false without touching anything when the snapshot is not there,
// matching reviveEntry's contract.
export function returnToHand(
  game: EngineGame, side: Side, entry: ZoneCardEntry, ctx: EngineContext,
): boolean {
  const index = discardIndexOf(game, side, entry)
  if (index < 0) return false
  const [snapshot] = game.state.destroyed[side].splice(index, 1)
  game.privates[side].hand.push({ ...snapshot, instanceId: ctx.newId() })
  // Checklist item 5: a direct push must resync the public count by hand.
  game.state.counts[side].hand = game.privates[side].hand.length
  return true
}

// The price both reviving cards pay: take the sacrificing hull off the board
// and out of play through discardCard, the single exit every card leaving play
// uses — so a captured hull still goes home and a summonOnly one still never
// reaches a discard. Returns false without touching anything when the hull is
// not where the caller thinks it is.
export function sacrificeEntry(
  game: EngineGame, side: Side, instanceId: string, zoneId: number,
): boolean {
  const zone = zoneById(game.state, zoneId)
  if (!zone) return false
  const index = zone.cards[side].findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return false
  const [entry] = zone.cards[side].splice(index, 1)
  discardCard(game, side, entry)
  return true
}
