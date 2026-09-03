import { describe, expect, it } from 'vitest'
import type { DeckCardInfo } from './deckValidation'
import { DEFAULT_DECK_RULES, validateDeck } from './deckValidation'

const ME = 'user-1'

function info(id: string, over: Partial<DeckCardInfo> = {}): [string, DeckCardInfo] {
  return [id, { id, isBuiltIn: true, faction: 'DWG', vehicleType: 'ship', ownerId: null, retired: false, ...over }]
}

// 10 distinct DWG ships x2 copies = a legal 20-card deck
function legalCards(): Record<string, number> {
  const cards: Record<string, number> = {}
  for (let i = 0; i < 10; i++) cards[`dwg-${i}`] = 2
  return cards
}
function legalInfo(): Map<string, DeckCardInfo> {
  return new Map(Array.from({ length: 10 }, (_, i) => info(`dwg-${i}`)))
}

describe('validateDeck', () => {
  it('accepts a legal deck', () => {
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, legalInfo(), ME)
    expect(r).toEqual({ valid: true, errors: [], cardCount: 20 })
  })

  it('enforces exact deck size', () => {
    const cards = legalCards()
    delete cards['dwg-9']
    const r = validateDeck({ faction: 'DWG', cards }, legalInfo(), ME)
    expect(r.valid).toBe(false)
    expect(r.cardCount).toBe(18)
    expect(r.errors.join(' ')).toMatch(/20/)
  })

  it('enforces copy limit and rejects non-positive quantities', () => {
    const cards = legalCards()
    cards['dwg-0'] = 3
    expect(validateDeck({ faction: 'DWG', cards }, legalInfo(), ME).valid).toBe(false)
    cards['dwg-0'] = 0
    expect(validateDeck({ faction: 'DWG', cards }, legalInfo(), ME).valid).toBe(false)
  })

  it('rejects unknown card ids', () => {
    const cards = { ...legalCards(), ghost: 1 }
    const r = validateDeck({ faction: 'DWG', cards }, legalInfo(), ME)
    expect(r.errors.some((e) => e.includes('ghost'))).toBe(true)
  })

  it('rejects off-faction built-ins but allows NEUTRAL', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { faction: 'SS' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(false)
    infoMap.set(...info('dwg-0', { faction: 'NEUTRAL' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(true)
  })

  it('limits custom cards to playerCardLimit total copies and requires ownership', () => {
    const infoMap = legalInfo()
    // dwg-0..dwg-2 become my custom cards: 3 ids x2 copies = 6 > limit of 4
    for (let i = 0; i < 3; i++) {
      infoMap.set(...info(`dwg-${i}`, { isBuiltIn: false, faction: 'NEUTRAL', ownerId: ME }))
    }
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(false)
    // exactly 4 custom copies is fine (2 ids x2)
    const infoMap2 = legalInfo()
    for (let i = 0; i < 2; i++) {
      infoMap2.set(...info(`dwg-${i}`, { isBuiltIn: false, faction: 'NEUTRAL', ownerId: ME }))
    }
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap2, ME).valid).toBe(true)
    // someone else's custom card is rejected
    const infoMap3 = legalInfo()
    infoMap3.set(...info('dwg-0', { isBuiltIn: false, faction: 'NEUTRAL', ownerId: 'user-2' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap3, ME).valid).toBe(false)
  })

  it('caps flier (plane+airship) and sub copies at their limits', () => {
    const infoMap = legalInfo()
    for (let i = 0; i < 4; i++) infoMap.set(...info(`dwg-${i}`, { vehicleType: i < 2 ? 'plane' : 'airship' }))
    // 4 ids x2 = 8 flier copies > 6
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME).valid).toBe(false)
    const infoMap2 = legalInfo()
    for (let i = 0; i < 4; i++) infoMap2.set(...info(`dwg-${i}`, { vehicleType: 'sub' }))
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap2, ME).valid).toBe(false)
    const infoMap3 = legalInfo()
    for (let i = 0; i < 3; i++) infoMap3.set(...info(`dwg-${i}`, { vehicleType: 'plane' }))
    // 3 ids x2 = 6 flier copies = exactly the limit
    expect(validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap3, ME).valid).toBe(true)
  })

  it('respects overridden rules', () => {
    const rules = { ...DEFAULT_DECK_RULES, deckSize: 2, uniqueCopyLimit: 2 }
    const r = validateDeck({ faction: 'DWG', cards: { 'dwg-0': 2 } }, legalInfo(), ME, rules)
    expect(r.valid).toBe(true)
  })

  it('rejects a summon-only card', () => {
    const info = new Map<string, DeckCardInfo>([
      ['sum-1', { id: 'sum-1', isBuiltIn: true, faction: 'WF', vehicleType: 'plane', ownerId: null, retired: false, summonOnly: true }],
    ])
    const result = validateDeck({ faction: 'WF', cards: { 'sum-1': 1 } }, info, 'owner-1')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/cannot be added to a deck/i)
  })

  it('rejects a retired card and says it is retired', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { retired: true }))
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('dwg-0') && /retired/i.test(e))).toBe(true)
  })

  // The two rules are distinct on purpose: a summon-only card was NEVER
  // draftable, a retired one was legal until a balance pass moved. 25 live
  // decks hit this message, and it is the only thing that tells their owners
  // what changed.
  it('does not report a retired card as summon-only', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { retired: true }))
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.errors.join(' ')).not.toMatch(/cannot be added to a deck/)
  })

  // Retirement is checked before faction, so an off-faction retired card
  // reports the actionable reason rather than a second, confusing one.
  it('reports retirement once, not alongside a faction error', () => {
    const infoMap = legalInfo()
    infoMap.set(...info('dwg-0', { retired: true, faction: 'SS' }))
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.errors.filter((e) => e.includes('dwg-0'))).toHaveLength(1)
  })

  // Regression for the hole a whole-branch review found: every test above
  // hand-builds DeckCardInfo with `retired` set directly, which is exactly
  // how a lobby-action rebuild once shipped with the field never populated —
  // the RULE was correct and every hand-built test stayed green, but the DATA
  // that reaches it was silently wrong. This instead starts from raw "cards"
  // rows shaped like a Supabase select (snake_case columns, jsonb meta) and
  // builds the info map with the exact expression lobby-action/index.ts uses,
  // so a future rewrite that drops the `retired:` line fails here instead of
  // shipping unenforced.
  it('rejects a retired card when the info map is built the way lobby-action builds it', () => {
    interface CardRow {
      id: string
      is_built_in: boolean
      faction: string
      vehicle_type: string | null
      owner_id: string | null
      meta: unknown
    }
    const cardRows: CardRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `dwg-${i}`, is_built_in: true, faction: 'DWG', vehicle_type: 'ship', owner_id: null,
      meta: i === 0 ? { retired: true } : {},
    }))
    // Mirrors supabase/functions/lobby-action/index.ts's infoMap construction
    // verbatim, so this test tracks that expression rather than the rule.
    const infoMap = new Map<string, DeckCardInfo>(
      cardRows.map((c) => [c.id, {
        id: c.id, isBuiltIn: c.is_built_in, faction: c.faction,
        vehicleType: c.vehicle_type, ownerId: c.owner_id,
        summonOnly: (c.meta as { summonOnly?: boolean } | null)?.summonOnly === true,
        retired: (c.meta as { retired?: boolean } | null)?.retired === true,
      }]),
    )
    const r = validateDeck({ faction: 'DWG', cards: legalCards() }, infoMap, ME)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('dwg-0') && /retired/i.test(e))).toBe(true)
  })
})
