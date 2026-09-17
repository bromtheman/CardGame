import { describe, expect, it } from 'vitest'
import { EXPECTATION_MAX_CHARS, LLM_MAX_PLAN_LENGTH, TABLE_TALK_MAX_CHARS } from './llmSettings'
import { parsePlanAnswer, PLAN_SCHEMA } from './planSchema'

const good = { plan: [3, 1], expectation: { summary: 'Deploy and end.', battle: null }, tableTalk: 'Ahoy.' }

describe('parsePlanAnswer', () => {
  it('accepts a well-formed answer', () => {
    expect(parsePlanAnswer(JSON.stringify(good))).toEqual(good)
    const withBattle = { ...good, expectation: { summary: 's', battle: { zoneId: 2, outcome: 'win', confidence: 0.7 } }, tableTalk: null }
    expect(parsePlanAnswer(JSON.stringify(withBattle))).toEqual(withBattle)
  })
  it('rejects malformed JSON, wrong shapes and bad enums', () => {
    expect(parsePlanAnswer('not json')).toBeNull()
    expect(parsePlanAnswer(JSON.stringify({ ...good, plan: [] }))).toBeNull()
    expect(parsePlanAnswer(JSON.stringify({ ...good, plan: ['1'] }))).toBeNull()
    expect(parsePlanAnswer(JSON.stringify({ ...good, plan: [1.5] }))).toBeNull()
    expect(parsePlanAnswer(JSON.stringify({ ...good, expectation: { summary: 's' } }))).toBeNull()
    expect(parsePlanAnswer(JSON.stringify({ ...good, expectation: { summary: 's', battle: { zoneId: 1, outcome: 'draw', confidence: 0.5 } } }))).toBeNull()
    expect(parsePlanAnswer(JSON.stringify({ ...good, tableTalk: 7 }))).toBeNull()
  })
  it('truncates over-long fields instead of rejecting them', () => {
    const long = { plan: Array.from({ length: LLM_MAX_PLAN_LENGTH + 5 }, (_, i) => i + 1), expectation: { summary: 'x'.repeat(EXPECTATION_MAX_CHARS + 50), battle: null }, tableTalk: 'y'.repeat(TABLE_TALK_MAX_CHARS + 50) }
    const parsed = parsePlanAnswer(JSON.stringify(long))!
    expect(parsed.plan.length).toBe(LLM_MAX_PLAN_LENGTH)
    expect(parsed.expectation.summary.length).toBe(EXPECTATION_MAX_CHARS)
    expect(parsed.tableTalk!.length).toBe(TABLE_TALK_MAX_CHARS)
  })
  it('accepts a fenced answer the same as the unfenced one', () => {
    const fenced = '```json\n' + JSON.stringify(good) + '\n```'
    expect(parsePlanAnswer(fenced)).toEqual(parsePlanAnswer(JSON.stringify(good)))
  })
  it('publishes the same limits in the schema', () => {
    const schema = PLAN_SCHEMA as { properties: { plan: { maxItems: number }; tableTalk: { anyOf: { maxLength?: number }[] } } }
    expect(schema.properties.plan.maxItems).toBe(LLM_MAX_PLAN_LENGTH)
    expect(schema.properties.tableTalk.anyOf.some((o) => o.maxLength === TABLE_TALK_MAX_CHARS)).toBe(true)
  })
})
