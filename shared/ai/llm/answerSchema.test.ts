import { describe, expect, it } from 'vitest'
import { ACTIONS_PER_ANSWER, EXPECTATION_MAX_CHARS, TABLE_TALK_MAX_CHARS } from './llmSettings'
import { ANSWER_SCHEMA, parseAnswer } from './answerSchema'

const good = { actions: [3], then: 'next', note: 'Deploy Corsair, then fight.', battle: null, tableTalk: 'Ahoy.' }
const parsed = { actions: [3], then: 'next', expectation: { summary: 'Deploy Corsair, then fight.', battle: null }, tableTalk: 'Ahoy.' }

describe('parseAnswer', () => {
  it('accepts a well-formed answer, an empty one, and a battle prediction', () => {
    expect(parseAnswer(JSON.stringify(good))).toEqual(parsed)
    expect(parseAnswer(JSON.stringify({ ...good, actions: [], then: 'continue' }))).toEqual({ ...parsed, actions: [], then: 'continue' })
    const battle = { zoneId: 2, outcome: 'win', confidence: 0.7 }
    expect(parseAnswer(JSON.stringify({ ...good, battle }))!.expectation.battle).toEqual(battle)
    expect(parseAnswer(JSON.stringify({ ...good, tableTalk: null }))!.tableTalk).toBeNull()
  })
  it('rejects malformed JSON, wrong shapes and bad enums', () => {
    expect(parseAnswer('not json')).toBeNull()
    expect(parseAnswer(JSON.stringify({ ...good, actions: 'one' }))).toBeNull()
    expect(parseAnswer(JSON.stringify({ ...good, actions: ['x'] }))).toBeNull()
    expect(parseAnswer(JSON.stringify({ ...good, actions: [1.5] }))).toBeNull()
    expect(parseAnswer(JSON.stringify({ ...good, then: 'stop' }))).toBeNull()
    expect(parseAnswer(JSON.stringify({ actions: [1], then: 'next', battle: null, tableTalk: null }))).toBeNull()   // no note
    expect(parseAnswer(JSON.stringify({ ...good, battle: { zoneId: 1, outcome: 'draw', confidence: 0.5 } }))).toBeNull()
    expect(parseAnswer(JSON.stringify({ ...good, tableTalk: 7 }))).toBeNull()
  })
  it('truncates over-long fields instead of rejecting them, and clamps confidence', () => {
    const long = { ...good, actions: [1, 2, 3, 4], note: 'x'.repeat(EXPECTATION_MAX_CHARS + 50), tableTalk: 'y'.repeat(TABLE_TALK_MAX_CHARS + 50), battle: { zoneId: 1, outcome: 'lose', confidence: 4 } }
    const p = parseAnswer(JSON.stringify(long))!
    expect(p.actions.length).toBe(ACTIONS_PER_ANSWER)
    expect(p.expectation.summary.length).toBe(EXPECTATION_MAX_CHARS)
    expect(p.tableTalk!.length).toBe(TABLE_TALK_MAX_CHARS)
    expect(p.expectation.battle!.confidence).toBe(1)
    expect(parseAnswer(JSON.stringify(long), 3)!.actions).toEqual([1, 2, 3])   // the policy's setting wins over the constant
  })
  it('accepts a fenced answer and menu numbers written as "#2" or "2"', () => {
    expect(parseAnswer('```json\n' + JSON.stringify(good) + '\n```')).toEqual(parsed)
    expect(parseAnswer(JSON.stringify({ ...good, actions: ['#2'] }))!.actions).toEqual([2])
    expect(parseAnswer(JSON.stringify({ ...good, actions: ['2'] }))!.actions).toEqual([2])
    expect(parseAnswer(JSON.stringify({ ...good, actions: ['#'] }))).toBeNull()
  })
  it('publishes the same limits in the schema', () => {
    const schema = ANSWER_SCHEMA as unknown as { properties: { actions: { maxItems: number }; note: { maxLength: number }; then: { enum: string[] } } }
    expect(schema.properties.actions.maxItems).toBe(ACTIONS_PER_ANSWER)
    expect(schema.properties.note.maxLength).toBe(EXPECTATION_MAX_CHARS)
    expect(schema.properties.then.enum).toEqual(['continue', 'next'])
  })
})
