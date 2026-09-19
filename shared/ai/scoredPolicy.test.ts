import { describe, expect, it } from 'vitest'
import { applyAction } from '../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures'
import { basicPolicy } from './basicPolicy'
import { botOwes, runBotUntilIdle } from './botDriver'
import { viewFor } from './botView'
import type { MenuItem } from './llm/moveMenu'
import { rankByScore, scoredPolicy } from './scoredPolicy'
import { matchupFor, newGame, parseFactions, reportBattle, STEP_CAP, TURN_CAP } from './selfPlayHarness'
import { cardId, loadSeedData } from '../../supabase/seed/transform'
import type { SeedCard } from '../types'
import type { SnapshotCard } from '../engine/gameInit'

const item = (id: number, type: MenuItem['action']['type'], score: number | null): MenuItem =>
  ({ id, action: { type } as MenuItem['action'], text: type, section: null, score })

describe('rankByScore', () => {
  it('sorts best first, keeps menu order on ties, and END TURN loses every tie', () => {
    const ranked = rankByScore([item(1, 'END_TURN', 0), item(2, 'ATTACK_ENEMY_BASE', 0.5), item(3, 'PLAY_CARD_TO_ZONE', 0), item(4, 'PLAY_ABILITY_CARD', null), item(5, 'USE_HERO_POWER', 2)])
    expect(ranked.map((m) => m.id)).toEqual([5, 2, 3, 4, 1])
  })
})

describe('scoredPolicy', () => {
  it('plays the best-scored move first and ends the turn only when nothing scores above it', async () => {
    const g = makeGame({ activePlayer: 'bob', turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
    g.state.resources.b.materials = 225000
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, playedOnTurn: 1 }))
    const { game, applied } = await runBotUntilIdle(g, 'bob', makeCtx(), scoredPolicy)
    expect(applied.map((a) => a.type)).toContain('PLAY_CARD_TO_ZONE')
    expect(applied.map((a) => a.type)).toContain('ATTACK_ENEMY_BASE')
    expect(applied[applied.length - 1].type).toBe('END_TURN')
    expect(game.activePlayer).toBe('alice')
  })
  it('answers the one-move kinds with the heuristic’s order', () => {
    const g = makeGame({ activePlayer: 'bob' })
    g.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: 'pick', options: [{ id: 'x', label: 'x' }] }
    const view = viewFor(g, 'b', makeCtx().rng)
    expect(scoredPolicy.candidates(view, 'choice')).toEqual(basicPolicy.candidates(view, 'choice'))
  })
})

// The strength net (spec §10.1): scored vs basicPolicy, 12 seeded mirror
// games — deterministic, so the count is exact, not a probability.
function toSnapshot(card: SeedCard): SnapshotCard {
  return {
    cardId: cardId(card.faction, card.name), name: card.name, isBuiltIn: true, ownerId: null,
    faction: card.faction, type: card.type, vehicleType: card.vehicleType,
    blueprintCost: card.blueprintCost, materialCost: card.materialCost, cpCost: card.cpCost,
    cardText: card.cardText ?? '', imageUrl: card.imageUrl ?? '',
    keywords: card.keywords ?? [], meta: (card.meta ?? {}) as Record<string, unknown>,
  }
}
describe('scoredPolicy against basicPolicy', () => {
  it('wins at least 9 of 12 seeded mirror games', async () => {
    const { cards } = await loadSeedData()
    const catalog = cards.filter((c) => c.isBuiltIn).map(toSnapshot)
    const byName = new Map(catalog.map((c) => [`${c.faction}:${c.name}`, c]))
    const factions = parseFactions('', 'mirror')
    let wins = 0
    for (let i = 0; i < 12; i++) {
      const seed = 1 + i
      const focal: 'a' | 'b' = i % 2 === 0 ? 'b' : 'a'
      const { factionA, factionB } = matchupFor(factions, i, 'mirror')
      const { game: start, ctx, rng } = newGame({ seed, factionA, factionB, catalog, byName })
      let game = start
      const act = async (side: 'a' | 'b') => {
        const id = side === 'a' ? 'alice' : 'bot'
        if (!botOwes(game, side)) return
        game = (await runBotUntilIdle(game, id, ctx, side === focal ? scoredPolicy : basicPolicy)).game
      }
      for (let step = 0; step < STEP_CAP; step++) {
        await act('a'); await act('b')
        if (game.status !== 'active' || game.turnNumber >= TURN_CAP) break
        if (game.state.activeBattle && !game.state.pendingReport && !game.state.pendingEffect) {
          const defender = game.state.activeBattle.aggressor === 'a' ? 'bot' : 'alice'
          const r = applyAction(game, defender, reportBattle(game, rng), ctx)
          if (!r.ok) throw new Error(r.error)
          game = r.game
        }
      }
      if (game.winnerId === (focal === 'a' ? 'alice' : 'bot')) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(9)
  }, 60_000)
})
