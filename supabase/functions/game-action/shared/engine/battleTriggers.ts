import { TRIGGERS } from '../gameSettings.ts'
import type { CardInstance, SnapshotCard } from './gameInit.ts'
import type {
  BattleCasualty, BattleContext, EngineContext, EngineGame, Side, ZoneCardEntry,
} from './engineTypes.ts'
import { discardCard, discardSnapshotOf, otherSide, ownerSideOf, zoneById } from './gameEngine.ts'
import { BYSTANDER_EFFECTS, effectFor, effectName } from '../effects/registry.ts'

// DP2 (spec §4.3, and its seven "DP2 departure" subsections). This module owns
// the whole battle-trigger dispatch and registers no handler of its own: the
// three seams that call it are battleDeclare.ts (lock), battleResolve.ts
// (resolve) and baseAttack.ts (bombardment).
//
// Unlike every dispatch point before it, DP2's three keys were named on zero
// seeded cards when wave 4 opened, so the wave authored the dispatch and the
// seed data together.

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
      const entry = (zone.cards[side] as ZoneCardEntry[]).find((c) => c.instanceId === id) ??
        summons.get(id)
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
//   3. state.zoneEffects riders on that zone belonging to the defending side.
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
    fire(game, ctx, entry, side, TRIGGERS.ON_BATTLE_EFFECT, context(side !== battle.aggressor, true))
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

  // A spent ability keeps firing through state.zoneEffects (decision 22). The
  // entry stores the registry name directly, so the effect is looked up by
  // that rather than through a meta key, and the card it is handed is minted
  // from the catalog by name — DWG Waters itself is in state.destroyed by now.
  const riders = game.state.zoneEffects.filter((e) => e.zoneId === battle.zoneId && e.side === defenderSide)
  for (const rider of riders) {
    const fn = effectFor(rider.effect)
    if (!fn) continue
    const snapshot = ctx.catalog.find((c) => c.isBuiltIn && c.name === rider.cardName)
    // A cardName the catalog cannot supply is a data problem, not a
    // game-stopping one: skip the rider rather than failing a locked battle.
    if (!snapshot) continue
    const card: CardInstance = { ...snapshot, instanceId: ctx.newId() }
    if (!fn({ game, actor: defenderSide, card, ctx, battle: context(true, false) })) {
      game.state.log.push(`${rider.cardName}'s battle trigger could not resolve`)
    }
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
  for (const rider of game.state.zoneEffects) {
    if (rider.zoneId !== zoneId || rider.side !== defenderSide) continue
    // One interception is enough: a battle already declared means the
    // bombardment is spent.
    if (game.state.activeBattle) return
    const fn = effectFor(rider.effect)
    if (!fn) continue
    const snapshot = ctx.catalog.find((c) => c.isBuiltIn && c.name === rider.cardName)
    if (!snapshot) continue
    const card: CardInstance = { ...snapshot, instanceId: ctx.newId() }
    if (!fn({ game, actor: defenderSide, card, ctx, battle: context })) {
      game.state.log.push(`${rider.cardName}'s zone effect could not resolve`)
    }
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
  const pile = game.state.destroyed[ownerSideOf(entry, side)]
  const wanted = discardSnapshotOf(entry, side)
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
  game.state.destroyed[ownerSideOf(entry, side)].splice(index, 1)
  zone.cards[side].push(entry)
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
