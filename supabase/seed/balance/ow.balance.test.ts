import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — OW's share, pinned against the seed source.
//
// One file per faction so the five faction branches never edit the same test
// file (spec §2.3). Costs, keywords and card text are plain data that nothing
// else in the suite reads: effectCoverage asks only whether a card's EFFECTS
// are wired, and seedDataSync only whether the generated SQL matches its
// source. Both stay green if a number is fat-fingered. This file would not.
//
// Numbers are spelled out, never derived — a test that recomputes its
// expectation from the source it is checking proves nothing.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

describe('2026-09-02 balance pass — OW', () => {
  // Populated by the OW wave. Vitest fails a file with no tests at all, so
  // this placeholder keeps the suite green until then. The wave that fills the
  // file deletes it.
  it('has a seed to read', async () => {
    expect((await bySeedKey()).size).toBeGreaterThan(0)
  })
})
