import { ACTIONS_PER_ANSWER, EXPECTATION_MAX_CHARS, TABLE_TALK_MAX_CHARS } from './llmSettings.ts'
import { menuId, unfence } from './planSchema.ts'
import type { Expectation } from './telemetry.ts'

// The sectioned flow's answer (2026-09-18 sectioned bot turn spec §4.5): up
// to ACTIONS_PER_ANSWER menu numbers ([] = nothing more in this section),
// where to go next, a private note, the battle prediction on an attack, one
// public line. Sent as a strict JSON schema in response_format AND
// re-validated here — the provider's enforcement is never trusted. Lengths
// are truncated rather than refused; types are not. The parser does not know
// the menu: mapping numbers to items, and the all-unknown-is-malformed rule,
// belong to the policy.
export type Then = 'continue' | 'next'
export interface Answer { actions: number[]; then: Then; expectation: Expectation; tableTalk: string | null }

export const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['actions', 'then', 'note', 'battle', 'tableTalk'],
  properties: {
    actions: { type: 'array', maxItems: ACTIONS_PER_ANSWER, items: { type: 'integer' } },
    then: { type: 'string', enum: ['continue', 'next'] },
    note: { type: 'string', maxLength: EXPECTATION_MAX_CHARS },
    battle: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false, required: ['zoneId', 'outcome', 'confidence'],
          properties: {
            zoneId: { type: 'integer' },
            outcome: { type: 'string', enum: ['win', 'lose', 'even'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      ],
    },
    tableTalk: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: TABLE_TALK_MAX_CHARS }] },
  },
} as const

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

// `maxActions` is the policy's setting (LlmPolicySettings.actionsPerAnswer)
// so a test can exercise a plan of two; production passes the constant.
export function parseAnswer(text: string, maxActions: number = ACTIONS_PER_ANSWER): Answer | null {
  let raw: unknown
  try { raw = JSON.parse(unfence(text)) } catch { return null }
  if (!isRecord(raw)) return null
  const { actions, then, note, battle, tableTalk } = raw
  if (!Array.isArray(actions)) return null
  const ids = actions.map(menuId)
  if (ids.some((n) => n === null)) return null
  if (then !== 'continue' && then !== 'next') return null
  if (typeof note !== 'string') return null
  let parsedBattle: Expectation['battle'] = null
  if (battle !== null && battle !== undefined) {
    if (!isRecord(battle) || !Number.isInteger(battle.zoneId) || typeof battle.confidence !== 'number') return null
    if (battle.outcome !== 'win' && battle.outcome !== 'lose' && battle.outcome !== 'even') return null
    parsedBattle = { zoneId: battle.zoneId as number, outcome: battle.outcome, confidence: Math.min(1, Math.max(0, battle.confidence)) }
  }
  if (tableTalk !== null && tableTalk !== undefined && typeof tableTalk !== 'string') return null
  return {
    actions: (ids as number[]).slice(0, maxActions),
    then,
    expectation: { summary: note.slice(0, EXPECTATION_MAX_CHARS), battle: parsedBattle },
    tableTalk: typeof tableTalk === 'string' ? tableTalk.slice(0, TABLE_TALK_MAX_CHARS) : null,
  }
}
