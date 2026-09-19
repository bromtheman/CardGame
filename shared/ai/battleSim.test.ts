import { describe, expect, it } from 'vitest'
import { KEYWORDS, REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT } from '../gameSettings'
import type { EngineGame } from '../engine/engineTypes'
import { makeGame, zoneEntry } from '../engine/testFixtures'
import { hullStrength, lossFraction, resolveBattle } from './battleSim'
import { mulberry32 } from './seededRng'
import { reportBattle } from './selfPlayHarness'

// DWG hulls with profiles (shared/shipProfiles/DWG.ts): Corsair is fire 1 /
// tough 1 (vs ships 2, aircraft 3, subs 1); Crossbones fire 5 / tough 4 (vs
// ships 5, aircraft 2, subs 1). "Test Vehicle" (the fixture default) has none.
const corsair = (id: string) => zoneEntry({ instanceId: id, name: 'Corsair', faction: 'DWG', vehicleType: 'ship', materialCost: 100000 })
const crossbones = (id: string) => zoneEntry({ instanceId: id, name: 'Crossbones', faction: 'DWG', vehicleType: 'ship', materialCost: 100000 })
const plain = (id: string, cost = 100000, over: Parameters<typeof zoneEntry>[0] = {}) => zoneEntry({ instanceId: id, materialCost: cost, vehicleType: 'ship', ...over })

describe('hullStrength', () => {
  it('is the effective cost, offense and defense alike, for a hull without a profile', () => {
    expect(hullStrength(plain('p'), [plain('e')])).toEqual({ offense: 100000, defense: 100000 })
  })
  it('shades offense by firepower and the matchup, and defense by toughness', () => {
    const weak = hullStrength(corsair('c'), [plain('e')])          // fire 1, tough 1, vs ships 2
    const strong = hullStrength(crossbones('x'), [plain('e')])     // fire 5, tough 4, vs ships 5
    expect(weak.offense).toBeLessThan(100000)
    expect(weak.defense).toBeLessThan(100000)
    expect(strong.offense).toBeGreaterThan(100000)
    expect(strong.defense).toBeGreaterThan(100000)
    expect(strong.offense).toBeGreaterThan(weak.offense)
  })
  it('reads the matchup against what the enemy actually fields', () => {
    // Corsair: vs aircraft 3 (neutral), vs ships 2 — it fights planes better than ships.
    const vsPlanes = hullStrength(corsair('c'), [plain('e', 100000, { vehicleType: 'plane' })])
    const vsShips = hullStrength(corsair('c'), [plain('e')])
    expect(vsPlanes.offense).toBeGreaterThan(vsShips.offense)
    expect(vsPlanes.defense).toBe(vsShips.defense)   // toughness does not depend on the enemy
  })
  it('gives an Inoffensive hull no offense but its full defense', () => {
    const s = hullStrength(plain('i', 100000, { keywords: [KEYWORDS.INOFFENSIVE] }), [plain('e')])
    expect(s.offense).toBe(0)
    expect(s.defense).toBe(100000)
  })
  it('prices a Half-Cost hull at its effective cost', () => {
    const s = hullStrength(plain('h', 100000, { keywords: [KEYWORDS.HALF_COST] }), [plain('e')])
    expect(s).toEqual({ offense: 50000, defense: 50000 })
  })
})

describe('lossFraction', () => {
  it('is a half in an even fight, three quarters when outgunned three to one, a quarter the other way', () => {
    expect(lossFraction(100, 100)).toBeCloseTo(0.5)
    expect(lossFraction(100, 300)).toBeCloseTo(0.75)
    expect(lossFraction(300, 100)).toBeCloseTo(0.25)
  })
  it('never divides by zero: no defense means total loss, no enemy offense means none', () => {
    expect(lossFraction(0, 100)).toBe(1)
    expect(lossFraction(100, 0)).toBe(0)
    expect(lossFraction(0, 0)).toBe(0)
  })
})

// A battle in zone 1: `mine` on side b attack `theirs` on side a.
function battle(mine: ReturnType<typeof zoneEntry>[], theirs: ReturnType<typeof zoneEntry>[], summons: ReturnType<typeof zoneEntry>[] = []): EngineGame {
  const g = makeGame({ activePlayer: 'bob', turnNumber: 3 })
  g.state.zones[0].cards.b.push(...mine)
  g.state.zones[0].cards.a.push(...theirs)
  g.state.activeBattle = {
    zoneId: 1, aggressor: 'b',
    attackerIds: [...mine.map((m) => m.instanceId), ...summons.map((s) => s.instanceId)],
    defenderIds: theirs.map((t) => t.instanceId),
    distanceM: 1200, distanceModifiedBy: [], summons, continuation: null,
  }
  return g
}
const alive = (hp: number) => hp >= SURVIVE_HP_PERCENT

describe('resolveBattle', () => {
  it('reports an integer HP from 0 to 100 for every participant, summons included', () => {
    const summon = zoneEntry({ instanceId: 'swarm', name: 'Mirth Swarm', materialCost: 10000, vehicleType: 'airship' })
    const g = battle([plain('m1'), plain('m2')], [plain('t1')], [summon])
    const results = resolveBattle(g, mulberry32(7))
    expect(Object.keys(results).sort()).toEqual(['m1', 'm2', 'swarm', 't1'])
    for (const hp of Object.values(results)) {
      expect(Number.isInteger(hp)).toBe(true)
      expect(hp).toBeGreaterThanOrEqual(0)
      expect(hp).toBeLessThanOrEqual(100)
    }
  })
  it('is deterministic for a seed', () => {
    const g = battle([plain('m1'), plain('m2')], [plain('t1'), plain('t2')])
    expect(resolveBattle(g, mulberry32(11))).toEqual(resolveBattle(g, mulberry32(11)))
    expect(resolveBattle(g, mulberry32(11))).not.toEqual(resolveBattle(g, mulberry32(12)))
  })
  it('lets a five-to-one side keep most of its hulls and take most of the other side’s', () => {
    // Over many seeds: the strong side's hulls survive far more often than
    // the weak side's. Cost is the strength here — no profiles.
    const g = battle([plain('m1', 250000), plain('m2', 250000)], [plain('t1', 50000), plain('t2', 50000)])
    let strongAlive = 0, weakAlive = 0
    for (let seed = 1; seed <= 60; seed++) {
      const r = resolveBattle(g, mulberry32(seed))
      strongAlive += Number(alive(r.m1)) + Number(alive(r.m2))
      weakAlive += Number(alive(r.t1)) + Number(alive(r.t2))
    }
    expect(strongAlive / 120).toBeGreaterThan(0.7)
    expect(weakAlive / 120).toBeLessThan(0.35)
  })
  it('makes an even fight bloody on both sides, with deaths and repairs both possible', () => {
    const g = battle([plain('m1'), plain('m2'), plain('m3')], [plain('t1'), plain('t2'), plain('t3')])
    const hps: number[] = []
    for (let seed = 1; seed <= 60; seed++) hps.push(...Object.values(resolveBattle(g, mulberry32(seed))))
    const survived = hps.filter(alive).length / hps.length
    expect(survived).toBeGreaterThan(0.3)
    expect(survived).toBeLessThan(0.7)
    expect(hps.some((hp) => hp < REPAIR_WINDOW_MIN_PERCENT)).toBe(true)                                   // destroyed
    expect(hps.some((hp) => hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT)).toBe(true)      // repairable
  })
  it('lets the profiles decide between hulls of equal cost', () => {
    // Two Crossbones (fire 5 / tough 4) against two Corsairs (fire 1 / tough 1)
    // at the same printed cost: the profiled strength, not the price, wins.
    const g = battle([crossbones('x1'), crossbones('x2')], [corsair('c1'), corsair('c2')])
    let strongAlive = 0, weakAlive = 0
    for (let seed = 1; seed <= 60; seed++) {
      const r = resolveBattle(g, mulberry32(seed))
      strongAlive += Number(alive(r.x1)) + Number(alive(r.x2))
      weakAlive += Number(alive(r.c1)) + Number(alive(r.c2))
    }
    expect(strongAlive).toBeGreaterThan(weakAlive * 1.5)
  })
})

describe('reportBattle', () => {
  it('submits the resolver’s figures as the human’s report, repairing nothing', () => {
    const g = battle([plain('m1'), plain('m2')], [plain('t1')])
    expect(reportBattle(g, mulberry32(5))).toEqual({ type: 'SUBMIT_BATTLE_REPORT', results: resolveBattle(g, mulberry32(5)), repairs: [] })
  })
})
