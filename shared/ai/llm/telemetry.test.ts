import { describe, expect, it } from 'vitest'
import { toBotDecisionRow } from './telemetry'
import type { TelemetryRow } from './telemetry'

describe('toBotDecisionRow', () => {
  it('maps a policy row onto the bot_decisions columns, section and seq included', () => {
    const row: TelemetryRow = {
      turnNumber: 3.5, kind: 'turn', model: 'inception/mercury-2.5', latencyMs: 812,
      promptTokens: 5100, completionTokens: 120, cachedTokens: 4000, costUsd: 0.00024,
      menuSize: 17,
      plan: [{ id: 2, text: 'PLAY Corsair (75k) to zone 1', action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'c1', zoneId: 1 } }],
      applied: [{ type: 'PLAY_CARD_TO_ZONE', instanceId: 'c1', zoneId: 1 }],
      expectation: { summary: 'Build up zone 1.', battle: null },
      report: null, tableTalk: 'Corsair on the water.', fallbackReason: null, error: null,
      section: 'deploy', seq: 2,
    }
    expect(toBotDecisionRow(row, 'game-1', 7)).toEqual({
      game_id: 'game-1', version: 7, turn_number: 3.5, kind: 'turn', model: 'inception/mercury-2.5',
      latency_ms: 812, prompt_tokens: 5100, completion_tokens: 120, cached_tokens: 4000, cost_usd: 0.00024,
      menu_size: 17, plan: row.plan, applied: row.applied, expectation: row.expectation, report: null,
      table_talk: 'Corsair on the water.', fallback_reason: null, error: null,
      section: 'deploy', seq: 2,
    })
  })
  it('accepts the single flow’s null section and seq, and the passed reason', () => {
    const row: TelemetryRow = {
      turnNumber: 4, kind: 'response', model: 'm', latencyMs: 10, promptTokens: null, completionTokens: null, cachedTokens: null, costUsd: null,
      menuSize: 3, plan: [], applied: [], expectation: null, report: null, tableTalk: null, fallbackReason: 'passed', error: null,
      section: null, seq: null,
    }
    expect(toBotDecisionRow(row, 'g', 1)).toMatchObject({ section: null, seq: null, fallback_reason: 'passed' })
  })
})
