import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'

// A data key's VALUE is never checked by G1/G2/G3 — only its presence
// (docs/claude/card-effects.md, blind spot 4). `retired` gates deck legality
// for 25 live decks, so it gets its own seed-backed assertion.
//
// Asserted in BOTH directions: a card missing from this list is not retired,
// and a card in it is. A one-directional check would stay green if a later
// pass retired a card by accident.
const RETIRED = ['OW:Halberd', 'SS:Dryad', 'TG:Acceptance', 'TG:Amusement', 'WF:Harbringer']

describe('2026-09-02 retirements', () => {
  it('retires exactly the five cards the pass names', async () => {
    const { cards } = await loadSeedData()
    const actual = cards
      .filter((c) => (c.meta as { retired?: unknown } | undefined)?.retired === true)
      .map((c) => `${c.faction}:${c.name}`)
      .sort()
    expect(actual).toEqual([...RETIRED].sort())
  })

  // Retirement keeps the ROW. Deleting it would break 25 saved decks at game
  // start rather than at deck edit — gameInit's expandDeck throws on a
  // dangling card id (spec §2.1).
  it('keeps every retired card seeded, so snapshots still resolve', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Set(cards.map((c) => `${c.faction}:${c.name}`))
    for (const key of RETIRED) expect(byKey.has(key)).toBe(true)
  })

  // The effects these cards name keep a naming card, so G4 stays green and
  // none of them belongs in DELIBERATE_ORPHANS (spec §5).
  it('leaves the retired cards still naming their effects', async () => {
    const { cards } = await loadSeedData()
    const meta = (key: string) =>
      (cards.find((c) => `${c.faction}:${c.name}` === key)!.meta ?? {}) as Record<string, unknown>
    expect(meta('OW:Halberd').onDeathEffect).toBe('halberdOnDeath')
    expect(meta('SS:Dryad').onBattleEffect).toBe('dryadBattle')
    expect(meta('WF:Harbringer').onBattleEffect).toBe('harbringerBattle')
  })
})
