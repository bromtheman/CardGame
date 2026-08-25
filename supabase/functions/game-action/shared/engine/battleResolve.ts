import {
  KEYWORDS, REPAIR_COST_RATE, REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT,
} from '../gameSettings.ts'
import type { SnapshotCard } from './gameInit.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { err, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'

export function repairCostOf(card: { materialCost: number; keywords: string[] }): number {
  if (card.keywords.includes(KEYWORDS.SCRAPPY)) return 0
  return Math.ceil(effectiveMaterialCostOf(card) * REPAIR_COST_RATE)
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
  for (const id of action.repairs) {
    const participant = participants.get(id)
    const hp = action.results[id]
    if (!participant) return err(400, 'Repair selection includes a non-participant')
    if (hp === undefined || hp < REPAIR_WINDOW_MIN_PERCENT || hp >= SURVIVE_HP_PERCENT) {
      return err(400, `${participant.entry.name} is not in the repairable band`)
    }
    if (participant.entry.keywords.includes(KEYWORDS.FRAGILE)) {
      return err(400, `${participant.entry.name} is Fragile and cannot be repaired`)
    }
  }
  game.state.pendingReport = { submittedBy: actor, results: action.results, repairs: action.repairs }
  game.state.log.push(`Battle report submitted by player ${actor.toUpperCase()} — awaiting approval`)
  return { ok: true, game }
})

registerHandler('DECIDE_BATTLE_REPORT', (game, actor, action) => {
  if (action.type !== 'DECIDE_BATTLE_REPORT') return err(400, 'Bad action')
  const report = game.state.pendingReport
  if (!report) return err(409, 'No report awaits a decision')
  if (actor === report.submittedBy) return err(403, 'The other captain must approve your report')
  if (!action.approve) {
    game.state.pendingReport = null
    game.state.log.push('Battle report rejected — submit a corrected one')
    return { ok: true, game }
  }
  const participants = participantsOf(game)
  // Repair affordability first (all-or-nothing).
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of report.repairs) {
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
  for (const [id, { entry, side }] of participants) {
    const hp = report.results[id]
    const survives = hp >= SURVIVE_HP_PERCENT ||
      (hp >= REPAIR_WINDOW_MIN_PERCENT && report.repairs.includes(id))
    if (!survives) {
      zone.cards[side] = zone.cards[side].filter((c) => c.instanceId !== id)
      const { instanceId: _i, playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = entry
      game.state.destroyed[side].push(snapshot as SnapshotCard)
      destroyedCount++
      game.state.log.push(`${entry.name} was destroyed (${hp}%)`)
    } else if (report.repairs.includes(id)) {
      game.state.log.push(`${entry.name} was repaired (${hp}%)`)
    }
  }
  game.state.activeBattle = null
  game.state.pendingReport = null
  game.state.log.push(`Battle resolved — ${destroyedCount} vehicle(s) lost`)
  return { ok: true, game }
})
