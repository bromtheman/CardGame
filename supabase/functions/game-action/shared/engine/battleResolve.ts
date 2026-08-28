import {
  KEYWORDS, REPAIR_COST_RATE, REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT,
} from '../gameSettings.ts'
import type { SnapshotCard } from './gameInit.ts'
import type { ApplyResult, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { err, isSummonOnly, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'
import { effectFor, effectName } from '../effects/registry.ts'

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

// Shared eligibility rule for a repair pick — used identically by the
// submitter (SUBMIT_BATTLE_REPORT) and the approver (DECIDE_BATTLE_REPORT):
// must be a real participant, must belong to the caller, must sit in the
// repairable HP band, and must not be Fragile. Returns the first failure as
// an ApplyResult, or null when every id is valid, so each caller keeps its
// own early-return shape.
function validateRepairChoices(
  ids: string[],
  participants: Map<string, { entry: ZoneCardEntry; side: Side }>,
  results: Record<string, number>,
  actor: Side,
): ApplyResult | null {
  for (const id of ids) {
    const p = participants.get(id)
    if (!p) return err(400, 'Repair selection includes a non-participant')
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

function participantsOf(game: EngineGame): Map<string, { entry: ZoneCardEntry; side: Side }> {
  const battle = game.state.activeBattle!
  const zone = zoneById(game.state, battle.zoneId)!
  const map = new Map<string, { entry: ZoneCardEntry; side: Side }>()
  for (const id of battle.attackerIds) {
    const entry = zone.cards[battle.aggressor].find((c) => c.instanceId === id)
    if (entry) map.set(id, { entry: entry as ZoneCardEntry, side: battle.aggressor })
  }
  const defenderSide: Side = battle.aggressor === 'a' ? 'b' : 'a'
  for (const id of battle.defenderIds) {
    const entry = zone.cards[defenderSide].find((c) => c.instanceId === id)
    if (entry) map.set(id, { entry: entry as ZoneCardEntry, side: defenderSide })
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
  const invalidRepair = validateRepairChoices(action.repairs, participants, action.results, actor)
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
  const participants = participantsOf(game)
  const roster = [...participants.values()]

  // Each side chooses only for its own vehicles: the submitter's picks came
  // with the report, the approver's arrive with the decision.
  const approverRepairs = Array.isArray(action.repairs) ? action.repairs : []
  const invalidApproverRepair = validateRepairChoices(approverRepairs, participants, report.results, actor)
  if (invalidApproverRepair) return invalidApproverRepair

  // A Set both unions the two sides' picks and makes an explicitly-listed
  // Scrappy vehicle redundant rather than double-charged.
  const repairIds = new Set([
    ...report.repairs,
    ...approverRepairs,
    ...autoRepairIds(roster, report.results),
  ])

  // Repair affordability first (all-or-nothing), per owner.
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of repairIds) {
    const p = participants.get(id)
    if (p) owed[p.side] += repairCostOf(p.entry)
  }
  for (const side of ['a', 'b'] as Side[]) {
    if (owed[side] > game.state.resources[side].materials) {
      return err(400, `Player ${side.toUpperCase()} cannot afford their repairs — reject and resubmit`)
    }
  }
  for (const side of ['a', 'b'] as Side[]) game.state.resources[side].materials -= owed[side]
  const zone = zoneById(game.state, game.state.activeBattle!.zoneId)!
  let destroyedCount = 0
  const destroyedEntries: { entry: ZoneCardEntry; side: Side }[] = []
  for (const [id, { entry, side }] of participants) {
    const hp = report.results[id]
    const survives = hp >= SURVIVE_HP_PERCENT ||
      (hp >= REPAIR_WINDOW_MIN_PERCENT && repairIds.has(id))
    if (!survives) {
      zone.cards[side] = zone.cards[side].filter((c) => c.instanceId !== id)
      const { instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, activatedOnTurn: _a, ...snapshot } = entry
      if (!isSummonOnly(entry)) game.state.destroyed[side].push(snapshot as SnapshotCard)
      destroyedCount++
      game.state.log.push(`${entry.name} was destroyed (${hp}%)`)
      destroyedEntries.push({ entry, side })
    } else if (repairIds.has(id)) {
      game.state.log.push(`${entry.name} was repaired (${hp}%)`)
    }
  }
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

  return { ok: true, game }
})
