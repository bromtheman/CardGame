import { describe, expect, it } from 'vitest'
import type { DeckCardInfo } from './deckValidation'
import { DEFAULT_DECK_RULES, validateDeck } from './deckValidation'

const ME = 'user-1'

function info(id: string, over: Partial<DeckCardInfo> = {}): [string, DeckCardInfo] {
  return [id, { id, isBuiltIn: true, faction: 'DWG', vehicleType: 'ship', ownerId: null, ...over }]
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
      ['sum-1', { id: 'sum-1', isBuiltIn: true, faction: 'WF', vehicleType: 'plane', ownerId: null, summonOnly: true }],
    ])
    const result = validateDeck({ faction: 'WF', cards: { 'sum-1': 1 } }, info, 'owner-1')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/cannot be added to a deck/i)
  })
})
