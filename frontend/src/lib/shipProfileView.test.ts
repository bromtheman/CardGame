import { describe, expect, it } from 'vitest'
import { shipProfileOf } from '@shared/shipProfiles'
import { pips, shipProfileRows } from './shipProfileView'

describe('pips', () => {
  it('draws a five-wide meter with the score filled', () => {
    expect(pips(1)).toBe('●○○○○')
    expect(pips(4)).toBe('●●●●○')
    expect(pips(5)).toBe('●●●●●')
  })
})

describe('shipProfileRows', () => {
  const profile = shipProfileOf('DWG', 'Crossbones')!

  it('lays the five scores and four matchups out as labelled rows, in report order', () => {
    const { scores, matchups } = shipProfileRows(profile)
    expect(scores.map((r) => r.label)).toEqual(['Firepower', 'Toughness', 'Speed', 'Range', 'Cost'])
    expect(matchups.map((r) => r.label)).toEqual(['vs Ships', 'vs Aircraft', 'vs Submarines', 'vs Missiles'])
  })

  it('carries each row’s score, its meter, its reason, and a spoken form for the meter', () => {
    const { scores, matchups } = shipProfileRows(profile)
    expect(scores[0]).toEqual({
      key: 'firepower', label: 'Firepower', score: 5, meter: '●●●●●',
      spoken: 'Firepower 5 of 5', why: profile.scores.firepower.why,
    })
    expect(matchups[2]).toEqual({
      key: 'submarines', label: 'vs Submarines', score: 1, meter: '●○○○○',
      spoken: 'vs Submarines 1 of 5', why: profile.matchups.submarines.why,
    })
  })
})
