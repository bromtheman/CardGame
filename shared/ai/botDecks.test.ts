import { describe, expect, it } from 'vitest'
import { cardId, loadSeedData } from '../../supabase/seed/transform'
import type { SeedCard } from '../types'
import { DEFAULT_DECK_RULES, validateDeck } from '../engine/deckValidation'
import type { DeckCardInfo } from '../engine/deckValidation'
import { VEHICLE_TYPES } from '../gameSettings'
import { BOT_DECKS, BOT_FACTIONS, isBotFaction } from './botDecks'

// Spec §3.2: the lists are pinned against the seed SOURCE, so a retirement or
// a rename fails here rather than in a lobby.
const MAX_TANK_COPIES = 3          // the default board is all water
const MIN_VEHICLES = 12
const TURN_ONE_BUDGET = 75_000     // floor(1.0) × MATERIALS_PER_TURN
const TURN_TWO_BUDGET = 150_000    // floor(2.0) × MATERIALS_PER_TURN

function eligible(cards: SeedCard[], faction: string): Map<string, SeedCard> {
  return new Map(
    cards
      .filter((c) => c.isBuiltIn && (c.faction === faction || c.faction === 'NEUTRAL'))
      .map((c) => [c.name, c]),
  )
}

describe('isBotFaction', () => {
  it('accepts the five fielded factions and nothing else', () => {
    for (const f of BOT_FACTIONS) expect(isBotFaction(f)).toBe(true)
    expect(isBotFaction('GT')).toBe(false)
    expect(isBotFaction('LH')).toBe(false)
    expect(isBotFaction('NEUTRAL')).toBe(false)
    expect(isBotFaction(undefined)).toBe(false)
  })
})

describe('bot decks', () => {
  for (const faction of BOT_FACTIONS) {
    describe(faction, () => {
      it('names only seeded, draftable cards of its faction or NEUTRAL', async () => {
        const { cards } = await loadSeedData()
        const byName = eligible(cards, faction)
        for (const name of Object.keys(BOT_DECKS[faction])) {
          const card = byName.get(name)
          expect(card, `"${name}" is not a seeded ${faction}/NEUTRAL built-in`).toBeDefined()
          const meta = (card!.meta ?? {}) as Record<string, unknown>
          expect(meta.retired, `"${name}" is retired`).not.toBe(true)
          expect(meta.summonOnly, `"${name}" is summon-only`).not.toBe(true)
        }
      })

      it('passes validateDeck under the default rules', async () => {
        const { cards } = await loadSeedData()
        const byName = eligible(cards, faction)
        const deck: Record<string, number> = {}
        const info = new Map<string, DeckCardInfo>()
        for (const [name, copies] of Object.entries(BOT_DECKS[faction])) {
          const card = byName.get(name)!
          const id = cardId(card.faction, card.name)
          deck[id] = copies
          const meta = (card.meta ?? {}) as Record<string, unknown>
          info.set(id, {
            id, isBuiltIn: true, faction: card.faction, vehicleType: card.vehicleType,
            ownerId: null, summonOnly: meta.summonOnly === true, retired: meta.retired === true,
          })
        }
        const result = validateDeck({ faction, cards: deck }, info, 'bot', DEFAULT_DECK_RULES)
        expect(result.errors).toEqual([])
        expect(result.valid).toBe(true)
      })

      it('is playable on the default all-water board and has early plays', async () => {
        const { cards } = await loadSeedData()
        const byName = eligible(cards, faction)
        let tanks = 0
        let vehicles = 0
        let turnOne = 0
        let turnTwo = 0
        for (const [name, copies] of Object.entries(BOT_DECKS[faction])) {
          const card = byName.get(name)!
          if (card.type !== 'vehicle') continue
          vehicles += copies
          if (card.vehicleType === VEHICLE_TYPES.TANK) tanks += copies
          if (card.materialCost <= TURN_ONE_BUDGET) turnOne += copies
          if (card.materialCost <= TURN_TWO_BUDGET) turnTwo += copies
        }
        expect(tanks).toBeLessThanOrEqual(MAX_TANK_COPIES)
        expect(vehicles).toBeGreaterThanOrEqual(MIN_VEHICLES)
        expect(turnOne).toBeGreaterThanOrEqual(1)   // a deliberately curated deck may hold one turn-one play (owner, 2026-09-17)
        expect(turnTwo).toBeGreaterThanOrEqual(4)
      })
    })
  }
})
