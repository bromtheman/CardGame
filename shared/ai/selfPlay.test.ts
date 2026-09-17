import { describe, expect, it } from 'vitest'
import { cardId, loadSeedData } from '../../supabase/seed/transform'
import type { SeedCard } from '../types'
import type { SnapshotCard } from '../engine/gameInit'
import { applyAction } from '../engine/index'
import { basicPolicy } from './basicPolicy'
import { BOT_FACTIONS } from './botDecks'
import { runBotUntilIdle } from './botDriver'
import { humanStep, newGame, STEP_CAP, TURN_CAP } from './selfPlayHarness'

// The net for effect interactions among the seeded cards (spec §9): the bot
// plays every one of its decks against a scripted human who deploys hulls,
// picks fights half the time, withdraws every hull it may from the bot's
// fleet attacks (so an attack the human can call off entirely IS called off,
// and a policy that re-declares one livelocks here instead of in production
// — a human who always fought hid exactly that), and reports every battle
// with random ending HP so deaths, repairs and death triggers all fire.
// Nothing here asserts on strategy — only that no seed, deck or card can
// wedge or crash the driver.
// Twenty seeds, as spec §9 aimed at: a game costs ~35 ms (measured
// 2026-09-16), so the file stays near four seconds.
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

function toSnapshot(card: SeedCard): SnapshotCard {
  return {
    cardId: cardId(card.faction, card.name), name: card.name, isBuiltIn: true, ownerId: null,
    faction: card.faction, type: card.type, vehicleType: card.vehicleType,
    blueprintCost: card.blueprintCost, materialCost: card.materialCost, cpCost: card.cpCost,
    cardText: card.cardText ?? '', imageUrl: card.imageUrl ?? '',
    keywords: card.keywords ?? [], meta: (card.meta ?? {}) as Record<string, unknown>,
  }
}

describe('self-play', () => {
  for (const [i, botFaction] of BOT_FACTIONS.entries()) {
    const humanFaction = BOT_FACTIONS[(i + 1) % BOT_FACTIONS.length]
    it(`PracticeAI (${botFaction}) vs a scripted ${humanFaction} over ${SEEDS.length} seeds`, async () => {
      const { cards } = await loadSeedData()
      const catalog = cards.filter((c) => c.isBuiltIn).map(toSnapshot)
      const byName = new Map(catalog.map((c) => [`${c.faction}:${c.name}`, c]))
      for (const seed of SEEDS) {
        const { game: start, ctx, rng } = newGame({ seed, factionA: humanFaction, factionB: botFaction, catalog, byName })
        let game = start
        const where = () => `(seed ${seed}, ${botFaction} vs ${humanFaction}, turn ${game.turnNumber})`
        for (let step = 0; step < STEP_CAP; step++) {
          try {
            game = (await runBotUntilIdle(game, 'bot', ctx, basicPolicy)).game
          } catch (e) {
            throw new Error(`bot threw ${where()}: ${e instanceof Error ? e.message : String(e)}`)
          }
          if (game.status !== 'active' || game.turnNumber >= TURN_CAP) break
          const action = humanStep(game, rng)
          if (!action) throw new Error(`nobody owes an action ${where()}`)
          let r = applyAction(game, 'alice', action, ctx)
          // The script is not a rules engine: a refused choice is declined, a
          // refused play or attack becomes END_TURN. Only a refused END_TURN
          // (or a refused response/report) is a finding.
          if (!r.ok && action.type === 'RESOLVE_PENDING_EFFECT' && !action.cancel) {
            r = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ctx)
          } else if (!r.ok && (action.type === 'PLAY_CARD_TO_ZONE' || action.type === 'ATTACK_ENEMY_FLEET')) {
            r = applyAction(game, 'alice', { type: 'END_TURN' }, ctx)
          }
          if (!r.ok) throw new Error(`human's ${action.type} refused ${where()}: ${r.error}`)
          game = r.game
        }
        expect(game.status !== 'active' || game.turnNumber >= TURN_CAP, `game never ended ${where()}`).toBe(true)
      }
    }, 120_000)
  }
})
