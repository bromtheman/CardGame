import { describe, expect, it } from 'vitest'
import type { Side } from '@shared/engine/engineTypes'

import { splitRosterBySide } from './reportTeams'

const roster = (...sides: Side[]) => sides.map((side, i) => ({ side, id: `v${i}` }))

describe('splitRosterBySide', () => {
  it('puts the viewer\u2019s ships in `mine` and the opponent\u2019s in `theirs`', () => {
    const { mine, theirs } = splitRosterBySide(roster('a', 'b', 'a'), 'a')
    expect(mine.map((p) => p.id)).toEqual(['v0', 'v2'])
    expect(theirs.map((p) => p.id)).toEqual(['v1'])
  })

  it('flips with the viewer, so each captain sees their own fleet on the left', () => {
    const fleet = roster('a', 'b', 'a')
    expect(splitRosterBySide(fleet, 'b').mine.map((p) => p.id)).toEqual(['v1'])
    expect(splitRosterBySide(fleet, 'b').theirs.map((p) => p.id)).toEqual(['v0', 'v2'])
  })

  it('covers every participant exactly once, so no vehicle drops out of the report', () => {
    const fleet = roster('a', 'b', 'b', 'a', 'b')
    const { mine, theirs } = splitRosterBySide(fleet, 'a')
    expect([...mine, ...theirs].map((p) => p.id).sort()).toEqual(fleet.map((p) => p.id).sort())
    expect(mine.filter((p) => theirs.includes(p))).toEqual([])
  })

  it('preserves roster order within each column', () => {
    const fleet = roster('a', 'a', 'a')
    expect(splitRosterBySide(fleet, 'a').mine.map((p) => p.id)).toEqual(['v0', 'v1', 'v2'])
  })

  it('returns an empty column when a side brought nothing', () => {
    const { mine, theirs } = splitRosterBySide(roster('b', 'b'), 'a')
    expect(mine).toEqual([])
    expect(theirs).toHaveLength(2)
  })
})
