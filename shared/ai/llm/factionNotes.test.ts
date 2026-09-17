import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../../../supabase/seed/transform'
import { BOT_DECKS, isBotFaction } from '../botDecks'
import { FACTION_NOTES, GENERAL_TIPS } from './factionNotes'

// Strategy prose the primer appends for the model. Pinned the way the bot
// decks are: a card the notes rely on must be seeded, draftable and in the
// bot's own deck, spelled as the seed prints it, so a rename, a retirement or
// a deck edit fails here rather than sending the model after a card it will
// never draw.

describe('faction notes', () => {
  it('carry no literal number — a cost or a count in prose rots against the next balance pass', () => {
    expect(GENERAL_TIPS).not.toMatch(/\d/)
    for (const [faction, note] of Object.entries(FACTION_NOTES)) expect(note.text, faction).not.toMatch(/\d/)
  })

  it('cover only factions the bot can field', () => {
    for (const faction of Object.keys(FACTION_NOTES)) expect(isBotFaction(faction), faction).toBe(true)
  })

  for (const [faction, note] of Object.entries(FACTION_NOTES)) {
    describe(faction, () => {
      it('mentions only seeded, draftable cards in the bot deck, or its faction hero powers, spelled as the seed prints them', async () => {
        const { cards, heroPowers } = await loadSeedData()
        const byName = new Map(cards.filter((c) => c.isBuiltIn && (c.faction === faction || c.faction === 'NEUTRAL')).map((c) => [c.name, c]))
        const powers = new Set(heroPowers.filter((h) => h.faction === faction).map((h) => h.name))
        const deck = BOT_DECKS[faction as keyof typeof BOT_DECKS]
        expect(note.mentions.length).toBeGreaterThan(0)
        for (const name of note.mentions) {
          expect(note.text, `"${name}" is listed but the prose does not use that spelling`).toContain(name)
          if (powers.has(name)) continue
          const card = byName.get(name)
          expect(card, `"${name}" is neither a seeded ${faction}/NEUTRAL built-in nor a ${faction} hero power`).toBeDefined()
          const meta = (card!.meta ?? {}) as Record<string, unknown>
          expect(meta.retired, `"${name}" is retired`).not.toBe(true)
          expect(deck[name], `"${name}" is not in the bot's ${faction} deck — the advice is inert`).toBeTruthy()
        }
      })
    })
  }
})
