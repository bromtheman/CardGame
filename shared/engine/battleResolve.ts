import {
  KEYWORDS, REPAIR_COST_RATE, REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT,
} from '../gameSettings.ts'
import type { ApplyResult, BattleCasualty, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { discardCard, err, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'
import { effectFor, effectName } from '../effects/registry.ts'
import { battleOutcome, dispatchBattleResolve } from './battleTriggers.ts'

// PublicGameState.activeBattle (gameInit.ts) structurally duplicates
// ActiveBattle (engineTypes.ts) rather than importing it (spec §4.4), so this
// is the type `game.state.activeBattle!` actually carries at this boundary.
type Battle = NonNullable<EngineGame['state']['activeBattle']>

export function repairCostOf(card: { materialCost: number; keywords: string[] }): number {
  if (card.keywords.includes(KEYWORDS.SCRAPPY)) return 0
  return Math.ceil(effectiveMaterialCostOf(card) * REPAIR_COST_RATE)
}

// Scrappy vehicles repair for free, so the engine applies it unconditionally
// rather than asking — there is no decision to make when the cost is zero.
// Fragile can never repair, and the band still gates everything. Exported so
// BattleOverlay previews exactly what the engine will do.
export function autoRepairIds(
  participants: { entry: { instanceId: string; keywords: string[] }; side: Side }[],
  results: Record<string, number>,
): string[] {
  const ids: string[] = []
  for (const { entry } of participants) {
    const hp = results[entry.instanceId]
    if (hp === undefined) continue
    if (hp < REPAIR_WINDOW_MIN_PERCENT || hp >= SURVIVE_HP_PERCENT) continue
    if (entry.keywords.includes(KEYWORDS.FRAGILE)) continue
    if (!entry.keywords.includes(KEYWORDS.SCRAPPY)) continue
    ids.push(entry.instanceId)
  }
  return ids
}

// Stronger than isSummonOnly and independent of it (spec §4.4): a battle
// summon evaporates on report approval whether or not the underlying card is
// draftable — Air Strafe's PredatorX and Orbit Flank's Orbit are ordinary
// catalog cards that still vanish, because they were never really on the
// board. A local predicate reads better than repeating this lookup at every
// site that needs it.
function isSummon(battle: Battle, id: string): boolean {
  return battle.summons.some((s) => s.instanceId === id)
}

// Shared eligibility rule for a repair pick — used identically by the
// submitter (SUBMIT_BATTLE_REPORT) and the approver (DECIDE_BATTLE_REPORT):
// must be a real participant, must not be a battle summon (refused outright —
// spec §4.4), must belong to the caller, must sit in the repairable HP band,
// and must not be Fragile. Returns the first failure as an ApplyResult, or
// null when every id is valid, so each caller keeps its own early-return shape.
function validateRepairChoices(
  ids: string[],
  participants: Map<string, { entry: ZoneCardEntry; side: Side }>,
  results: Record<string, number>,
  actor: Side,
  battle: Battle,
): ApplyResult | null {
  for (const id of ids) {
    const p = participants.get(id)
    if (!p) return err(400, 'Repair selection includes a non-participant')
    if (isSummon(battle, id)) return err(400, `${p.entry.name} is a summoned vehicle and cannot be repaired`)
    if (p.side !== actor) return err(400, `${p.entry.name} is not yours to repair — its captain decides`)
    const hp = results[id]
    if (hp === undefined || hp < REPAIR_WINDOW_MIN_PERCENT || hp >= SURVIVE_HP_PERCENT) {
      return err(400, `${p.entry.name} is not in the repairable band`)
    }
    if (p.entry.keywords.includes(KEYWORDS.FRAGILE)) {
      return err(400, `${p.entry.name} is Fragile and cannot be repaired`)
    }
  }
  return null
}

// Merges the two sources a battle draws combatants from (spec §4.4): entries
// still on the board, and summons that exist only inside this battle and
// never reach zone.cards. A summon carries no side field — membership in
// attackerIds/defenderIds decides it, so a listed id that misses the zone
// lookup falls back to the summon map with the side its own list implies.
function participantsOf(game: EngineGame): Map<string, { entry: ZoneCardEntry; side: Side }> {
  const battle = game.state.activeBattle!
  const zone = zoneById(game.state, battle.zoneId)!
  const summonMap = new Map<string, ZoneCardEntry>(
    battle.summons.map((s) => [s.instanceId, s as ZoneCardEntry]),
  )
  const map = new Map<string, { entry: ZoneCardEntry; side: Side }>()
  for (const id of battle.attackerIds) {
    const entry = zone.cards[battle.aggressor].find((c) => c.instanceId === id)
    if (entry) map.set(id, { entry: entry as ZoneCardEntry, side: battle.aggressor })
    else {
      const summon = summonMap.get(id)
      if (summon) map.set(id, { entry: summon, side: battle.aggressor })
    }
  }
  const defenderSide: Side = battle.aggressor === 'a' ? 'b' : 'a'
  for (const id of battle.defenderIds) {
    const entry = zone.cards[defenderSide].find((c) => c.instanceId === id)
    if (entry) map.set(id, { entry: entry as ZoneCardEntry, side: defenderSide })
    else {
      const summon = summonMap.get(id)
      if (summon) map.set(id, { entry: summon, side: defenderSide })
    }
  }
  return map
}

registerHandler('SUBMIT_BATTLE_REPORT', (game, actor, action) => {
  if (action.type !== 'SUBMIT_BATTLE_REPORT') return err(400, 'Bad action')
  if (typeof action.results !== 'object' || action.results === null || Array.isArray(action.results)) {
    return err(400, 'results must be an object mapping instanceId to ending HP')
  }
  if (!Array.isArray(action.repairs)) return err(400, 'repairs must be an array')
  if (!game.state.activeBattle) return err(409, 'No battle to report')
  if (game.state.pendingReport) return err(409, 'A report is already awaiting a decision')
  const participants = participantsOf(game)
  const reported = Object.keys(action.results)
  if (reported.length !== participants.size || reported.some((id) => !participants.has(id))) {
    return err(400, 'The report must cover exactly the vehicles in this battle')
  }
  if (new Set(action.repairs).size !== action.repairs.length) {
    return err(400, 'Repair list contains duplicates')
  }
  for (const [id, hp] of Object.entries(action.results)) {
    if (typeof hp !== 'number' || Number.isNaN(hp) || hp < 0 || hp > 100) {
      return err(400, 'Ending HP must be between 0 and 100')
    }
    void id
  }
  const invalidRepair = validateRepairChoices(
    action.repairs, participants, action.results, actor, game.state.activeBattle!,
  )
  if (invalidRepair) return invalidRepair
  game.state.pendingReport = { submittedBy: actor, results: action.results, repairs: action.repairs }
  game.state.log.push(`Battle report submitted by player ${actor.toUpperCase()} — awaiting approval`)
  return { ok: true, game }
})

registerHandler('DECIDE_BATTLE_REPORT', (game, actor, action, ctx) => {
  if (action.type !== 'DECIDE_BATTLE_REPORT') return err(400, 'Bad action')
  const report = game.state.pendingReport
  if (!report) return err(409, 'No report awaits a decision')
  if (actor === report.submittedBy) return err(403, 'The other captain must approve your report')
  if (action.approve !== true) {
    game.state.pendingReport = null
    game.state.log.push('Battle report rejected — submit a corrected one')
    return { ok: true, game }
  }
  const battle = game.state.activeBattle!
  const participants = participantsOf(game)
  // autoRepairIds must never see a summon (spec §4.4) — Scrappy's free-repair
  // auto-pick would otherwise silently apply to a hull that isn't really on
  // the board. This is the second of the two refusals; validateRepairChoices
  // below is the first, for an explicitly-listed id.
  const roster = [...participants.values()].filter((p) => !isSummon(battle, p.entry.instanceId))

  // Each side chooses only for its own vehicles: the submitter's picks came
  // with the report, the approver's arrive with the decision.
  const approverRepairs = Array.isArray(action.repairs) ? action.repairs : []
  const invalidApproverRepair = validateRepairChoices(approverRepairs, participants, report.results, actor, battle)
  if (invalidApproverRepair) return invalidApproverRepair

  // A Set both unions the two sides' picks and makes an explicitly-listed
  // Scrappy vehicle redundant rather than double-charged.
  const repairIds = new Set([
    ...report.repairs,
    ...approverRepairs,
    ...autoRepairIds(roster, report.results),
  ])

  // Repair affordability first (all-or-nothing), per owner. repairIds should
  // never legitimately contain a summon id — validateRepairChoices and the
  // non-summon roster fed to autoRepairIds above both refuse it upstream —
  // but this loop must not trust that unconditionally: a future regression
  // in either upstream guard must not silently charge a real vehicle's
  // repair cost for a hull that evaporates regardless of HP (spec §4.4).
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of repairIds) {
    const p = participants.get(id)
    if (p && !isSummon(battle, id)) owed[p.side] += repairCostOf(p.entry)
  }
  for (const side of ['a', 'b'] as Side[]) {
    if (owed[side] > game.state.resources[side].materials) {
      return err(400, `Player ${side.toUpperCase()} cannot afford their repairs — reject and resubmit`)
    }
  }
  for (const side of ['a', 'b'] as Side[]) game.state.resources[side].materials -= owed[side]
  const zone = zoneById(game.state, battle.zoneId)!
  let destroyedCount = 0
  let summonCount = 0
  // Doubles as DP2's casualty list (spec §4.3, DP2 departure 1): the death
  // triggers below iterate it, and dispatchBattleResolve carries it to Iron
  // Cordon and Sacrilego, which have no other route to "who died here, at what
  // HP". Summons never reach it — the branch that pushes is guarded on
  // !summon — which is right twice over: a summon evaporates rather than dies,
  // and there is nothing to revive.
  const destroyedEntries: BattleCasualty[] = []
  // DP2's win test reads the same `survives` predicate this loop already
  // computes — repairs included, so a Scrappy hull patched back over the line
  // is a survivor — and summons count (spec §4.3, DP2 departure 6).
  const survivingIds = new Set<string>()
  for (const [id, { entry, side }] of participants) {
    const hp = report.results[id]
    const summon = isSummon(battle, id)
    if (summon) summonCount++
    const survives = hp >= SURVIVE_HP_PERCENT ||
      (hp >= REPAIR_WINDOW_MIN_PERCENT && repairIds.has(id))
    if (survives) survivingIds.add(id)
    // A summon is skipped by every consequence of "not surviving" — no
    // zone.cards removal (it was never there), no discardCard (which would
    // otherwise leak it into state.destroyed and, via reshuffleDiscard, the
    // owner's deck), no destroyedEntries push (so no onDeathEffect dispatch
    // below), no destroyedCount increment. It cannot reach the repair branch
    // either in practice: validateRepairChoices and the roster filter above
    // are what keep a summon id out of repairIds in the first place.
    if (!survives && !summon) {
      zone.cards[side] = zone.cards[side].filter((c) => c.instanceId !== id)
      discardCard(game, side, entry)
      destroyedCount++
      game.state.log.push(`${entry.name} was destroyed (${hp}%)`)
      destroyedEntries.push({ entry, side, hp })
    } else if (repairIds.has(id)) {
      game.state.log.push(`${entry.name} was repaired (${hp}%)`)
    }
  }
  // One line for every summon in the battle, never one per card — six
  // Martyrs must not produce six log lines (spec §4.4).
  if (summonCount > 0) {
    game.state.log.push(`${summonCount} summoned vehicle(s) evaporated`)
  }
  // Read before activeBattle is nulled below, or they are lost. DP2's resolve
  // dispatch fires after that nulling — the battle freeze must already be off,
  // because a trigger may write state.pendingEffect — so the battle's identity
  // has to be carried forward in locals rather than read back off state.
  const continuation = battle.continuation
  const battleZoneId = battle.zoneId
  const aggressor = battle.aggressor
  const outcome = battleOutcome(participants, survivingIds, aggressor)
  game.state.activeBattle = null
  game.state.pendingReport = null
  game.state.log.push(`Battle resolved — ${destroyedCount} vehicle(s) lost`)

  // Death triggers fire after the battle is fully resolved. The battle
  // already happened, so a failing effect only gets a log note — it never
  // rejects the (already-approved) report. Unimplemented names are skipped
  // silently; their vanilla note already ran at play time (spec §3.9).
  for (const { entry, side } of destroyedEntries) {
    const name = effectName(entry, 'onDeathEffect')
    if (name === null) continue
    const fn = effectFor(name)
    if (!fn) continue
    if (!fn({ game, actor: side, card: entry, ctx })) {
      game.state.log.push(`${entry.name}'s death effect could not resolve`)
    }
  }

  // DP2 at resolve (spec §4.3). Deliberately placed AFTER the death triggers
  // above: Iron Cordon's whole job is to save an allied GT airship that has
  // just been destroyed, which means it must see that airship's snapshot
  // already in state.destroyed to pull it back out. The airship's own
  // onDeathEffect has therefore already fired by the time it is revived, and
  // stands (DP2 departure 7) — the same latitude this handler already takes
  // with a death effect that fails. Placed BEFORE the continuation below, so
  // Trebuchet's repeat remains the last thing a battle does.
  //
  // participants still holds a destroyed hull's entry even though zone.cards
  // no longer does, which is what makes the revive possible at all.
  dispatchBattleResolve(game, ctx, battleZoneId, aggressor, participants, outcome, destroyedEntries)

  // The continuation (spec §4.3, departure 3): an effect that forced this
  // battle and wants to run again now that it has resolved (Trebuchet's
  // repeat). Fires exactly once, after every death trigger above, and — like
  // RESOLVE_PENDING_EFFECT's rollback escape — logs and drops rather than
  // throwing if its registry name is no longer there. A false return gets
  // the same log-only treatment as a failing death effect: the report is
  // already approved and cannot be rolled back over it.
  if (continuation) {
    const fn = effectFor(continuation.effect)
    if (!fn) {
      game.state.log.push(`${continuation.card.name}'s effect is no longer available — the continuation was dropped`)
    } else if (!fn({ game, actor: continuation.side, card: continuation.card, ctx, continuation })) {
      game.state.log.push(`${continuation.card.name}'s effect could not resolve`)
    }
  }

  return { ok: true, game }
})
