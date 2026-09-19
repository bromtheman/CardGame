import { describe, expect, it } from 'vitest'
import { KEYWORDS } from '../gameSettings'
import { makeGame, zoneEntry } from '../engine/testFixtures'
import { EVALUATOR, positionScore, strikePower, turnsToWin } from './evaluator'

const hull = (cost: number, over: Parameters<typeof zoneEntry>[0] = {}) => zoneEntry({ materialCost: cost, vehicleType: 'ship', ...over })

describe('strikePower', () => {
  it('sums floor(cost / divisor) over hulls that can strike, fresh deployments included', () => {
    expect(strikePower([hull(150000, { playedOnTurn: 5 }), hull(40999)])).toBe(150 + 40)
  })
  it('skips submarines, Inoffensive, noBaseDamage and Temporary hulls', () => {
    expect(strikePower([
      hull(100000, { vehicleType: 'sub' }),
      hull(100000, { keywords: [KEYWORDS.INOFFENSIVE] }),
      hull(100000, { meta: { noBaseDamage: true } }),
      hull(100000, { keywords: [KEYWORDS.TEMPORARY] }),
    ])).toBe(0)
  })
})

describe('turnsToWin', () => {
  it('is the second-smallest zone time: two bases must fall', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(hull(500000))   // 1000 HP / 500 = 2 turns
    g.state.zones[1].cards.b.push(hull(100000))   // 10 turns
    expect(turnsToWin(g, 'b')).toBe(10)
    expect(turnsToWin(g, 'a')).toBe(EVALUATOR.capTurns)   // a strikes nowhere
  })
  it('counts a fallen base as zero and stalls a zone with no power or an enemy Blocker at the cap', () => {
    const g = makeGame()
    g.state.zones[0].baseHp.a = 0
    g.state.zones[1].cards.b.push(hull(200000))
    g.state.zones[1].cards.a.push(hull(40000, { keywords: [KEYWORDS.BLOCKER] }))
    g.state.zones[2].cards.b.push(hull(250000))   // 4 turns
    expect(turnsToWin(g, 'b')).toBe(4)            // [0, cap, 4] → second smallest
  })
})

describe('positionScore', () => {
  it('rises when the bot fields a striker and falls when the enemy does', () => {
    const empty = makeGame()
    const mine = makeGame(); mine.state.zones[0].cards.b.push(hull(200000)); mine.state.zones[1].cards.b.push(hull(200000))
    const theirs = makeGame(); theirs.state.zones[0].cards.a.push(hull(200000)); theirs.state.zones[1].cards.a.push(hull(200000))
    expect(positionScore(mine, 'b')).toBeGreaterThan(positionScore(empty, 'b'))
    expect(positionScore(theirs, 'b')).toBeLessThan(positionScore(empty, 'b'))
    expect(positionScore(mine, 'b')).toBeCloseTo(-positionScore(mine, 'a') + 2 * EVALUATOR.hand * 0, 5)   // symmetric with empty hands
  })
  it('values board cost, hand size and base HP as tie-breakers, in that order of weight', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(hull(100000, { vehicleType: 'sub' }))   // no strike power, still a hull
    expect(positionScore(g, 'b')).toBeGreaterThan(positionScore(makeGame(), 'b'))
    const drew = makeGame({ privates: { a: { hand: [], deck: [] }, b: { hand: [zoneEntry(), zoneEntry()], deck: [] } } })
    expect(positionScore(drew, 'b') - positionScore(makeGame(), 'b')).toBeCloseTo(2 * EVALUATOR.hand, 5)
    const hurt = makeGame(); hurt.state.zones[0].baseHp.a = 800
    expect(positionScore(hurt, 'b') - positionScore(makeGame(), 'b')).toBeCloseTo(200 * EVALUATOR.baseHp, 5)
  })
  it('is ±win on a decided game', () => {
    const g = makeGame({ status: 'complete', winnerId: 'bob' })
    expect(positionScore(g, 'b')).toBe(EVALUATOR.win)
    expect(positionScore(g, 'a')).toBe(-EVALUATOR.win)
  })
})
