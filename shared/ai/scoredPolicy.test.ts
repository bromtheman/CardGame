import { describe, expect, it } from 'vitest'
import { applyAction } from '../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures'
import { basicPolicy } from './basicPolicy'
import { botOwes, runBotUntilIdle } from './botDriver'
import { viewFor } from './botView'
import { buildMenu } from './llm/moveMenu'
import type { MenuItem } from './llm/moveMenu'
import { rankByScore, scoredPolicy } from './scoredPolicy'
import { matchupFor, newGame, parseFactions, reportBattle, STEP_CAP, TURN_CAP } from './selfPlayHarness'
import { cardId, loadSeedData } from '../../supabase/seed/transform'
import type { SeedCard } from '../types'
import type { SnapshotCard } from '../engine/gameInit'

const item = (id: number, type: MenuItem['action']['type'], score: number | null): MenuItem =>
  ({ id, action: { type } as MenuItem['action'], text: type, section: null, score })

describe('rankByScore', () => {
  it('ranks only a strictly positive delta above END TURN — best first, menu order on ties — and END TURN ahead of everything at or below it, in menu order', () => {
    // Zero and null are "no better than ending": END TURN goes first, and
    // the rest trail it in menu order as candidates for a refused END TURN.
    const ranked = rankByScore([
      item(1, 'END_TURN', 0), item(2, 'ATTACK_ENEMY_BASE', 0.5), item(3, 'PLAY_CARD_TO_ZONE', 0),
      item(4, 'PLAY_ABILITY_CARD', null), item(5, 'USE_HERO_POWER', 2), item(6, 'ATTACK_ENEMY_FLEET', -3),
      item(7, 'SET_ALERT_CARD', 0), item(8, 'PLAY_CARD_TO_ZONE', 0.5),
    ])
    expect(ranked.map((m) => m.id)).toEqual([5, 2, 8, 1, 3, 4, 6, 7])
  })
  it('keeps a menu without END TURN in the same shape: the positives sorted, the rest in menu order', () => {
    const ranked = rankByScore([item(1, 'SET_ALERT_CARD', 0), item(2, 'PLAY_CARD_TO_ZONE', 1), item(3, 'ATTACK_ENEMY_BASE', 0.2), item(4, 'USE_HERO_POWER', null)])
    expect(ranked.map((m) => m.id)).toEqual([2, 3, 1, 4])
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
  it('ends the turn at once when nothing scores above END TURN — never repeating a zero-delta move such as an alert', async () => {
    // An alert is always legal while an ability card is in hand (a re-reveal
    // replaces the last one) and worth exactly nothing (the alert expires
    // when the turn ends). Under the old "END TURN loses every tie" rule the
    // driver revealed it until BOT_ACTION_CAP — sixty menus per request and
    // as many "reveals" lines in the public log — before a fallback ended
    // the turn. Reachable in production on the no-key path and after any
    // mid-request trip, since scoredPolicy is both model policies' fallback.
    const g = makeGame({
      activePlayer: 'bob', turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ab-1', name: 'Ruse', type: 'ability', vehicleType: null, materialCost: 0 })], deck: [] } },
    })
    const offered = buildMenu(g, 'bob', makeCtx(), 'turn')
    expect(offered.some((m) => m.action.type === 'SET_ALERT_CARD')).toBe(true)   // the fixture really offers the alert
    expect(offered.filter((m) => m.action.type !== 'END_TURN').every((m) => (m.score ?? 0) <= 0)).toBe(true)   // and nothing beats ending
    const { game, applied } = await runBotUntilIdle(g, 'bob', makeCtx(), scoredPolicy)
    expect(applied.length).toBeLessThanOrEqual(3)
    expect(applied[applied.length - 1].type).toBe('END_TURN')
    expect(new Set(applied.map((a) => JSON.stringify(a))).size).toBe(applied.length)   // no action applied twice
    expect(game.state.log.filter((l) => l.includes(' reveals ')).length).toBeLessThanOrEqual(1)
    expect(game.activePlayer).toBe('alice')
  })
  it('does not re-declare a fleet attack the human just called off by withdrawing every defender', async () => {
    // The livelock (2026-09-20): the bot's 200k hull faces a lone Stealthy
    // 50k hull. Declared, the attack opens a response window; the human
    // withdraws the hull; the engine calls the attack off with the zone
    // activation unspent and the state otherwise unchanged (design spec
    // §3.4); the next request finds the bot owing its turn again, and a
    // policy that reads only the board sees the same attack, at the same
    // score, and declares it again — a withdrawal per lap for the human,
    // forever. The bot must end its turn instead, however many laps the
    // human has already withdrawn.
    const g = makeGame({ activePlayer: 'bob', turnNumber: 3 })
    g.state.zones[0].baseHp.a = 0   // no base attack to get in the way
    g.state.usedHeroPowers.b.push('rapidRedeployment')   // nor a redeployment to a zone with a base to bombard
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 200000, playedOnTurn: 2 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'ghost', materialCost: 50000, keywords: ['stealthy'] }))
    const declared = applyAction(g, 'bob', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx())
    if (!declared.ok) throw new Error(declared.error)
    const withdrawn = applyAction(declared.game, 'alice', { type: 'RESPOND_TO_ATTACK', optOutIds: ['ghost'] }, makeCtx())
    if (!withdrawn.ok) throw new Error(withdrawn.error)
    expect(withdrawn.game.state.log.at(-1)).toContain('called off')
    expect(withdrawn.game.state.zones[0].lastActivatedTurn).toBeNull()   // the lap costs the bot nothing — that is the trap
    expect(botOwes(withdrawn.game, 'b')).toBe('turn')
    const { game, applied } = await runBotUntilIdle(withdrawn.game, 'bob', makeCtx(), scoredPolicy)
    expect(applied).toEqual([{ type: 'END_TURN' }])
    expect(game.state.awaitingResponse).toBeNull()
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
