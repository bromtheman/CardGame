import { EXPECTATION_MAX_CHARS, LLM_MAX_PLAN_LENGTH, TABLE_TALK_MAX_CHARS } from './llmSettings.ts'
import type { Expectation } from './telemetry.ts'

// The model's whole answer (spec §5.3): menu ids in order, a private
// expectation, an optional public line. Sent as a strict JSON schema in
// response_format AND re-validated here — the provider's enforcement is
// never trusted. Lengths are truncated rather than refused; types are not.
export interface PlanAnswer { plan: number[]; expectation: Expectation; tableTalk: string | null }

export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['plan', 'expectation', 'tableTalk'],
  properties: {
    plan: { type: 'array', minItems: 1, maxItems: LLM_MAX_PLAN_LENGTH, items: { type: 'integer' } },
    expectation: {
      type: 'object', additionalProperties: false, required: ['summary', 'battle'],
      properties: {
        summary: { type: 'string', maxLength: EXPECTATION_MAX_CHARS },
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
      },
    },
    tableTalk: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: TABLE_TALK_MAX_CHARS }] },
  },
} as const

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

export function parsePlanAnswer(text: string): PlanAnswer | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (!isRecord(raw)) return null
  const { plan, expectation, tableTalk } = raw
  if (!Array.isArray(plan) || plan.length === 0 || !plan.every((n) => Number.isInteger(n))) return null
  if (!isRecord(expectation) || typeof expectation.summary !== 'string' || !('battle' in expectation)) return null
  let battle: Expectation['battle'] = null
  if (expectation.battle !== null) {
    const b = expectation.battle
    if (!isRecord(b) || !Number.isInteger(b.zoneId) || typeof b.confidence !== 'number') return null
    if (b.outcome !== 'win' && b.outcome !== 'lose' && b.outcome !== 'even') return null
    battle = { zoneId: b.zoneId as number, outcome: b.outcome, confidence: Math.min(1, Math.max(0, b.confidence)) }
  }
  if (tableTalk !== null && typeof tableTalk !== 'string') return null
  return {
    plan: (plan as number[]).slice(0, LLM_MAX_PLAN_LENGTH),
    expectation: { summary: expectation.summary.slice(0, EXPECTATION_MAX_CHARS), battle },
    tableTalk: tableTalk === null ? null : tableTalk.slice(0, TABLE_TALK_MAX_CHARS),
  }
}
