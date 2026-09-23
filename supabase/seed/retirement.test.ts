import { describe, expect, it } from 'vitest'
import { loadSeedData } from './transform'

// A data key's VALUE is never checked by G1/G2/G3 — only its presence
// (docs/claude/card-effects.md, blind spot 4). `retired` gates deck legality
// for 25 live decks, so it gets its own seed-backed assertion.
//
// Asserted in BOTH directions: a card missing from this list is not retired,
// and a card in it is. A one-directional check would stay green if a later
// pass retired a card by accident.
// TG:Horror joined on 2026-09-16 (spec M-9): Fear's rewrite removed its last spawner.
// DWG:Land Marauder joined on 2026-09-17 by owner decision, outside any pass.
// The 2026-09-21 LH redesign retired the old LH roster and the four [TG] pool cards (spec §7).
// Note TG:Amusement (an existing TG card, retired 2026-09-02) is distinct from
// TG:[TG] Amusement (the LH pool row, retired 2026-09-21) — both belong below.
const RETIRED = [
  'DWG:Land Marauder',
  'LH:Byte',
  'LH:Coulomb',
  'LH:Hydrovolt',
  'LH:Orbit',
  'LH:Orbit Flank',
  'LH:Robotic Assemblers',
  'LH:Sapphire',
  'LH:Sapphire Screen',
  'LH:Spectrum',
  'LH:Thunderbird',
  'OW:Halberd',
  'SS:Dryad',
  'TG:Acceptance',
  'TG:Amusement',
  'TG:Horror',
  'TG:[TG] Amusement',
  'TG:[TG] Fear',
  'TG:[TG] Hysteria',
  'TG:[TG] Obsession',
  'WF:Harbringer',
]

describe('card retirements (2026-09-02, 2026-09-16, 2026-09-17, 2026-09-21, 2026-09-22)', () => {
  it('retires exactly the twenty-one cards named above', async () => {
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
    expect(meta('TG:Horror').onBattleEffect).toBe('horrorBattle')
    expect(meta('WF:Harbringer').onBattleEffect).toBe('harbringerBattle')
    expect(meta('LH:Byte').onPlayEffect).toBe('byteChargeOnPlay')
    expect(meta('LH:Byte').onActivate).toBe('byteDraw')
  })
})
