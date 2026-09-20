import type { GameAction } from '../../engine/engineTypes.ts'
import type { OwedKind } from '../basicPolicy.ts'
import type { Section } from './sections.ts'
import type { GuardRecord } from './tempoGuard.ts'

// Why the model did not answer a call (spec §7.1). `disabled` = no key or the
// kill switch; `plan_rejected` = the engine refused a move the menu had
// verified (an engine bug, or an rng-dependent legality); `passed` = the
// sectioned flow's empty answer on a one-move kind, answered by the
// heuristic without a trip (2026-09-18 spec §3.3).
export type FallbackReason = 'timeout' | 'http' | 'malformed' | 'budget' | 'disabled' | 'plan_rejected' | 'passed'

export interface BattleExpectation { zoneId: number; outcome: 'win' | 'lose' | 'even'; confidence: number }
export interface Expectation { summary: string; battle: BattleExpectation | null }

// One row per model call, including failed ones (spec §7.2). Field names are
// camelCase here and snake_case in the table; toBotDecisionRow is the one map.
export interface TelemetryRow {
  turnNumber: number
  kind: OwedKind
  model: string
  latencyMs: number
  promptTokens: number | null
  completionTokens: number | null
  cachedTokens: number | null
  costUsd: number | null
  menuSize: number
  plan: { id: number; text: string; action: GameAction }[]
  applied: GameAction[]
  expectation: Expectation | null
  report: { results: Record<string, number>; repairs: string[] } | null
  // The line the model proposed; the driver's guard may have dropped it —
  // compare with the game's log.
  tableTalk: string | null
  fallbackReason: FallbackReason | null
  // The failure's HTTP status and message excerpt when fallbackReason is
  // set; never a key. Distinguishes a wrong key (401), a rate limit (429),
  // a provider 5xx and a model-id typo (400) — all of which read as just
  // 'http' in fallbackReason alone.
  error: string | null
  // Sectioned flow (2026-09-18 spec §7): the section a turn call was for
  // and the call's number within the request. Null in the single flow, on a
  // one-move kind's section, and on the disabled row.
  section: Section | null
  seq: number | null
  // The tempo guard's record when it replaced the model's pick (2026-09-19
  // scored menu spec §6.2, §7); null when it did not fire (or cannot yet —
  // the sectioned flow's guard is Task 8).
  guard: GuardRecord | null
}

export function toBotDecisionRow(row: TelemetryRow, gameId: string, version: number) {
  return {
    game_id: gameId, version, turn_number: row.turnNumber, kind: row.kind, model: row.model,
    latency_ms: row.latencyMs, prompt_tokens: row.promptTokens, completion_tokens: row.completionTokens,
    cached_tokens: row.cachedTokens, cost_usd: row.costUsd, menu_size: row.menuSize,
    plan: row.plan, applied: row.applied, expectation: row.expectation, report: row.report,
    table_talk: row.tableTalk, fallback_reason: row.fallbackReason, error: row.error,
    section: row.section, seq: row.seq, guard: row.guard,
  }
}
