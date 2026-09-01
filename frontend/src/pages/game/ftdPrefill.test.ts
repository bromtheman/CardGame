import { describe, expect, it } from 'vitest'

import { applyPrefill, prefillSummary, winnerLabel } from './ftdPrefill'

const participants = ['i-1', 'i-2', 'i-3']
const current = { 'i-1': 100, 'i-2': 100, 'i-3': 100 }

describe('applyPrefill', () => {
  it('overwrites the form values FtD reported', () => {
    const app = applyPrefill(current, { results: { 'i-1': 87, 'i-2': 0 } }, participants)
    expect(app.results).toEqual({ 'i-1': 87, 'i-2': 0, 'i-3': 100 })
    expect(app.matched).toEqual(['i-1', 'i-2'])
    expect(app.missing).toEqual(['i-3'])
  })

  it('never drops a participant from the map, so the report still covers the battle', () => {
    // SUBMIT_BATTLE_REPORT rejects a report that does not cover exactly the
    // battle's participants — a missing key would 400 the player.
    const app = applyPrefill(current, { results: {} }, participants)
    expect(Object.keys(app.results).sort()).toEqual(participants)
  })

  it('ignores an id that is not in this battle rather than writing it in', () => {
    const app = applyPrefill(current, { results: { 'i-1': 50, 'ghost': 10 } }, participants)
    expect(app.results).not.toHaveProperty('ghost')
    expect(app.unknown).toEqual(['ghost'])
  })

  it('clamps and rounds whatever it is handed', () => {
    const app = applyPrefill(current, { results: { 'i-1': 140, 'i-2': -3, 'i-3': 66.6 } }, participants)
    expect(app.results).toEqual({ 'i-1': 100, 'i-2': 0, 'i-3': 67 })
  })

  it('treats a non-finite or non-numeric value as not reported', () => {
    const app = applyPrefill(
      current,
      { results: { 'i-1': Number.NaN, 'i-2': 'x' as unknown as number } },
      participants,
    )
    expect(app.matched).toEqual([])
    expect(app.results).toEqual(current)
  })

  it('is a no-op when there is no prefill at all', () => {
    for (const p of [null, undefined, {}]) {
      const app = applyPrefill(current, p, participants)
      expect(app.results).toEqual(current)
      expect(app.matched).toEqual([])
    }
  })

  it('does not mutate the values it was given', () => {
    const before = { ...current }
    applyPrefill(current, { results: { 'i-1': 1 } }, participants)
    expect(current).toEqual(before)
  })
})

describe('prefillSummary', () => {
  const nameOf = (id: string) => ({ 'i-1': 'Marauder', 'i-2': 'Monsoon', 'i-3': 'Bulwark' }[id] ?? id)

  it('names the hulls still needing a number by hand', () => {
    const app = applyPrefill(current, { results: { 'i-1': 87 } }, participants)
    const text = prefillSummary(app, nameOf)
    expect(text).toContain('1 of 3')
    expect(text).toContain('Monsoon')
    expect(text).toContain('Bulwark')
  })

  it('says nothing about missing hulls when everything was covered', () => {
    const app = applyPrefill(current, { results: { 'i-1': 1, 'i-2': 2, 'i-3': 3 } }, participants)
    expect(prefillSummary(app, nameOf)).toBe('Filled in 3 of 3 vehicles.')
  })

  it('mentions ignored vehicles', () => {
    const app = applyPrefill(current, { results: { 'i-1': 1, ghost: 2 } }, participants)
    expect(prefillSummary(app, nameOf)).toContain('not in this battle')
  })

  it('is explicit when nothing matched at all', () => {
    const app = applyPrefill(current, { results: { ghost: 2 } }, participants)
    expect(prefillSummary(app, nameOf)).toContain('none of its vehicles matched')
  })
})

describe('winnerLabel', () => {
  const factionOf = (side: string) => (side === 'a' ? 'DWG' : 'OW')

  it('names the winning fleet', () => {
    expect(winnerLabel({ winningSide: 'b' }, factionOf)).toBe('OW won the fight in From The Depths.')
  })

  it('says nothing when the mod reported no placeable winner', () => {
    expect(winnerLabel({ winningSide: null }, factionOf)).toBeNull()
    expect(winnerLabel({}, factionOf)).toBeNull()
    expect(winnerLabel(null, factionOf)).toBeNull()
    // A team index that is neither 0 nor 1 resolves to null server-side.
    expect(winnerLabel({ winningSide: 'c' }, factionOf)).toBeNull()
  })
})
