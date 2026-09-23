import { describe, expect, it } from 'vitest'
import { KEYWORDS } from '../gameSettings'
import { inst, makeCtx, makeGame, snap, zoneEntry } from '../engine/testFixtures'
import { applyAction, sideOf } from '../engine/index'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import { boardChargeOf } from '../engine/index.ts'
import { EVALUATOR, positionScore, scoreMove, strikePower, turnsToWin } from './evaluator'

const hull = (cost: number, over: Parameters<typeof zoneEntry>[0] = {}) => zoneEntry({ materialCost: cost, vehicleType: 'ship', ...over })

describe('strikePower', () => {
  it('sums floor(cost / divisor) over hulls that can strike, fresh deployments included', () => {
    expect(strikePower([hull(150000, { playedOnTurn: 5 }), hull(40999)], 1)).toBe(150 + 40)
  })
  it('skips submarines, Inoffensive, noBaseDamage and Temporary hulls', () => {
    expect(strikePower([
      hull(100000, { vehicleType: 'sub' }),
      hull(100000, { keywords: [KEYWORDS.INOFFENSIVE] }),
      hull(100000, { meta: { noBaseDamage: true } }),
      hull(100000, { keywords: [KEYWORDS.TEMPORARY] }),
    ], 1)).toBe(0)
  })
})

describe('turnsToWin', () => {
  it('is the sum of the two smallest zone times: two bases must fall, and first-zone progress still counts', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(hull(500000))   // 1000 HP / 500 = 2 turns
    g.state.zones[1].cards.b.push(hull(100000))   // 10 turns
    expect(turnsToWin(g, 'b')).toBe(12)                     // [2, 10, cap] → 2 + 10
    expect(turnsToWin(g, 'a')).toBe(2 * EVALUATOR.capTurns) // a strikes nowhere: [cap, cap, cap] → cap + cap
  })
  it('counts a fallen base as zero and stalls a zone with no power or an enemy Blocker at the cap', () => {
    const g = makeGame()
    g.state.zones[0].baseHp.a = 0
    g.state.zones[1].cards.b.push(hull(200000))
    g.state.zones[1].cards.a.push(hull(40000, { keywords: [KEYWORDS.BLOCKER] }))
    g.state.zones[2].cards.b.push(hull(250000))   // 4 turns
    expect(turnsToWin(g, 'b')).toBe(4)            // [0, cap, 4] → sum of two smallest (0 + 4)
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
  it('scales board-cost advantage by lobby materialsPerTurn setting', () => {
    const defaultGame = makeGame()
    const defaultEmpty = makeGame()
    // A sub: board cost only, no strike power — turnsToWin (now a SUM, so no
    // longer immune to a single populated zone) must stay identical between
    // the "game" and "empty" halves of the comparison, or its materialsPerTurn-
    // independent turns swamp the board term this test isolates.
    defaultGame.state.zones[0].cards.b.push(hull(150000, { vehicleType: 'sub' }))

    const customGame = makeGame({ settings: { zones: [
      { biome: 'water', baseHp: 1000 },
      { biome: 'beach', baseHp: 1000 },
      { biome: 'land', baseHp: 1000 },
    ], materialsPerTurn: 150000 } })
    const customEmpty = makeGame({ settings: { zones: [
      { biome: 'water', baseHp: 1000 },
      { biome: 'beach', baseHp: 1000 },
      { biome: 'land', baseHp: 1000 },
    ], materialsPerTurn: 150000 } })
    customGame.state.zones[0].cards.b.push(hull(150000, { vehicleType: 'sub' }))

    const defaultDiff = positionScore(defaultGame, 'b') - positionScore(defaultEmpty, 'b')
    const customDiff = positionScore(customGame, 'b') - positionScore(customEmpty, 'b')
    // Custom income is 2x default, so board advantage is scaled to half
    expect(customDiff).toBeCloseTo(defaultDiff * 0.5, 5)
  })
})

const BOT = 'bob'
function turnGame() {
  // The bot (b) holds a 100k ship it can afford; a 150k hull of its own sits in zone 1 from an earlier turn.
  const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
  g.state.resources.b.materials = 225000
  g.state.zones[0].cards.b.push(hull(150000, { instanceId: 'mine-1', playedOnTurn: 1 }))
  return g
}

describe('scoreMove', () => {
  it('scores END TURN as the position it leaves, a deploy above it, and a bombardment above no bombardment', () => {
    const g = turnGame()
    const end = scoreMove(g, BOT, { type: 'END_TURN' }, makeCtx(), 1)!
    const deploy = scoreMove(g, BOT, { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-100', zoneId: 2 }, makeCtx(), 1)!
    const bombard = scoreMove(g, BOT, { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx(), 1)!
    expect(deploy).toBeGreaterThan(end)
    expect(bombard).toBeGreaterThan(end)
  })
  it('returns null for a move the engine refuses', () => {
    expect(scoreMove(turnGame(), BOT, { type: 'ATTACK_ENEMY_BASE', zoneId: 3 }, makeCtx(), 1)).toBeNull()
  })
  it('is deterministic per seed', () => {
    const g = turnGame()
    const a = { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-100', zoneId: 1 } as const
    expect(scoreMove(g, BOT, a, makeCtx(), 7)).toBe(scoreMove(g, BOT, a, makeCtx(), 7))
  })
  it('scores a fleet attack by playing the battle out: below END TURN against a far dearer fleet, above it against a far cheaper one', () => {
    const outgunned = turnGame()
    outgunned.state.zones[0].cards.a.push(hull(600000, { instanceId: 'big-1' }), hull(600000, { instanceId: 'big-2' }))
    const easy = turnGame()
    easy.state.zones[0].cards.a.push(hull(20000, { instanceId: 'small-1' }))
    const attack = { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 } as const
    expect(scoreMove(outgunned, BOT, attack, makeCtx(), 3)!).toBeLessThan(scoreMove(outgunned, BOT, { type: 'END_TURN' }, makeCtx(), 3)!)
    expect(scoreMove(easy, BOT, attack, makeCtx(), 3)!).toBeGreaterThan(scoreMove(easy, BOT, { type: 'END_TURN' }, makeCtx(), 3)!)
  })
  it('returns null for a fleet attack declared mid-battle: the engine refuses a second one', () => {
    const g = turnGame()
    g.state.zones[0].cards.a.push(hull(90000, { instanceId: 'foe-1' }))
    // An activeBattle already locks zone 1, built the way battleSim.test.ts's
    // own battle() helper builds one. ATTACK_ENEMY_FLEET is not a
    // BATTLE_ACTION, so the engine's battleFrozen gate refuses it outright —
    // scoreMove must return null, not score the pre-existing battle's snapshot.
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'b', attackerIds: ['mine-1'], defenderIds: ['foe-1'],
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    expect(scoreMove(g, BOT, { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx(), 9)).toBeNull()
  })
  it('samples a non-fleet-attack move that leaves a battle locked: a card effect that force-declares one', () => {
    // WF's Martyr Attack (wfEffects.ts martyrAttackEffect): an ability card
    // that summons Martyrs to fight a targeted enemy vehicle alone, via
    // declareForcedBattle — which locks activeBattle directly, with no
    // response window (battleDeclare.ts: a forced battle "skips the Stealthy
    // opt-out entirely"). The action here is PLAY_CARD_TARGETING_CARD_ON_FIELD,
    // never ATTACK_ENEMY_FLEET, so this only samples through battleMean if
    // scoreMove routes on the resulting state rather than the action type
    // (2026-09-19 scored-menu Task 3 fix round 2).
    const martyrHull = snap({ name: 'Martyr', faction: 'WF', vehicleType: 'plane', materialCost: 8500, meta: { summonOnly: true } })
    const martyrAttack = inst({
      instanceId: 'martyr-attack-1', name: 'Martyr Attack', type: 'ability', materialCost: 0,
      meta: { playOnVehicleEffect: 'martyrAttackEffect' },
    })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [martyrAttack], deck: [] } },
    })
    g.state.zones[0].cards.a.push(hull(90000, { instanceId: 'foe-1' }))
    const ctx = makeCtx({ catalog: [martyrHull] })
    const action = { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'martyr-attack-1', targetInstanceId: 'foe-1' } as const
    const sampled = scoreMove(g, BOT, action, ctx, 5)
    expect(sampled).not.toBeNull()
    // Not just non-null: it must differ from the unresolved pre-battle
    // snapshot (the exact bug this fixes) — the 4 Martyrs against foe-1
    // fight it out, they don't stand there forever unfought.
    const trial = applyAction(g, BOT, action, ctx)
    const unsampled = trial.ok ? positionScore(trial.game, sideOf(g, BOT)!) : null
    expect(sampled).not.toBe(unsampled)
  })
})

describe('evaluator — 2026-09-21 LH', () => {
  it('a stunned Blocker does not stall the zone and a stunned striker does not count', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(hull(200000, { playedOnTurn: 1 }), hull(300000, { playedOnTurn: 1, stunnedUntilTurn: 4 }))
    g.state.zones[0].cards.b.push(hull(40000, { keywords: [KEYWORDS.BLOCKER], stunnedUntilTurn: 4 }))
    expect(strikePower(g.state.zones[0].cards.a as ZoneCardEntry[], 3)).toBe(200)
    // Zone 1 is 1000 / 200 = 5 turns instead of the cap; the other two zones still stall.
    expect(turnsToWin(g, 'a')).toBe(5 + EVALUATOR.capTurns)
  })

  it('values pips on its own board over the enemy\'s', () => {
    const g = makeGame({ turnNumber: 3 })
    const base = positionScore(g, 'a')
    // A sub, so the strike term stays put and only the board and charge terms move.
    g.state.zones[0].cards.a.push(hull(40000, { faction: 'LH', vehicleType: 'sub', meta: { chargeMax: 2 }, charge: 2 }))
    expect(positionScore(g, 'a') - base).toBeCloseTo(EVALUATOR.charge * 2 + EVALUATOR.board * 40000 / (75000 * 3), 5)
    expect(boardChargeOf(g.state, 'a')).toBe(2)
  })
})

// 2026-09-23 EMP Torpedo: a charged LH hull beside a Blocker sub. Removing the
// sub reopens the lane to bombardment, so the scored flow must rank the
// torpedo above ending the turn — PracticeAI finds LH's answer to a locked lane.
describe('scoreMove — EMP Torpedo', () => {
  it('scores the torpedo on a Blocker sub above END TURN', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({
      instanceId: 'torpedo', name: 'EMP Torpedo', type: 'ability', vehicleType: null, faction: 'LH', materialCost: 100000,
      meta: { playOnVehicleEffect: 'empTorpedoEffect', dischargeFrom: 2 },
    })], deck: [] } } })
    g.state.factions = { a: 'TG', b: 'LH' }
    g.state.resources.b.materials = 100000
    g.state.zones[0].cards.b.push(hull(200000, { instanceId: 'ampere', name: 'Ampere', faction: 'LH', meta: { chargeMax: 2 }, charge: 2, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(hull(375000, { instanceId: 'agony', name: 'Agony', faction: 'TG', vehicleType: 'sub', keywords: [KEYWORDS.BLOCKER] }))
    const end = scoreMove(g, BOT, { type: 'END_TURN' }, makeCtx(), 1)!
    const torpedo = scoreMove(g, BOT, { type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'torpedo', targetInstanceId: 'ampere' }, makeCtx(), 1)!
    expect(torpedo).toBeGreaterThan(end)
  })
})
