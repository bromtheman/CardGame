import { describe, expect, it } from 'vitest'
import { applyAction } from '../../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../../engine/testFixtures'
import { describeAction, describeMenuItem, describeOutcome } from './describe'

const BOT = 'bob'

function applied(game: ReturnType<typeof makeGame>, action: Parameters<typeof applyAction>[2]) {
  const r = applyAction(game, BOT, action, makeCtx())
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('describeAction', () => {
  it('names hand cards, hulls, zones and powers', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'h1', name: 'Corsair', materialCost: 75000 })], deck: [] } } })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'm1', name: 'Marauder' }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'f1', name: 'Rook' }))
    expect(describeAction(g, 'b', { type: 'PLAY_CARD_TO_ZONE', instanceId: 'h1', zoneId: 1 })).toBe('PLAY Corsair (75k) to zone 1')
    expect(describeAction(g, 'b', { type: 'MOVE_VEHICLE', instanceId: 'm1', zoneId: 2 })).toBe('MOVE Marauder to zone 2')
    expect(describeAction(g, 'b', { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 })).toBe('ATTACK the enemy fleet in zone 1')
    expect(describeAction(g, 'b', { type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: 'm1', targetInstanceId: 'f1' })).toBe('HERO POWER Boarding Party: trade Marauder for Rook')
    expect(describeAction(g, 'b', { type: 'RESPOND_TO_ATTACK', optOutIds: [] })).toBe('FIGHT with every defender')
    expect(describeAction(g, 'b', { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: ['m1'] })).toBe('APPROVE the report and repair Marauder (20k)')
    expect(describeAction(g, 'b', { type: 'END_TURN' })).toBe('END TURN')
  })
})

describe('describeOutcome', () => {
  it('reports materials, zone hulls and the engine’s log lines for a play', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'h1', name: 'Corsair', materialCost: 40000 })], deck: [] } } })
    const after = applied(g, { type: 'PLAY_CARD_TO_ZONE', instanceId: 'h1', zoneId: 1 })
    const text = describeOutcome(g, after, 'b')
    expect(text).toContain('materials 100k→60k')
    expect(text).toContain('zone 1: your hulls 0→1 (+Corsair)')
    expect(text).toContain('Log:')
  })
  it('reports base HP for a base attack and strengths for a fleet attack', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'm1', name: 'Marauder', materialCost: 150000, playedOnTurn: 1 }))
    const hit = applied(g, { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    expect(describeOutcome(g, hit, 'b')).toContain('zone 1: enemy base 1000→850')

    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'f1', name: 'Rook', materialCost: 50000 }))
    const declared = applied(g, { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 })
    expect(describeOutcome(g, declared, 'b')).toContain('declares a fleet battle in zone 1 — yours 150k vs theirs 50k')
  })
  it('composes the menu line', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    const after = applied(g, { type: 'END_TURN' })
    const text = describeMenuItem(g, after, 'b', { type: 'END_TURN' })
    expect(text.startsWith('END TURN → ')).toBe(true)
    expect(text).toContain('ends your turn')
  })
  it('counts only vehicle losses — a scrapped ability card is not a lost hull, a destroyed vehicle still is', () => {
    // state.destroyed is the general discard pile: spendCard files every
    // resolved ability card there too, so a raw pile-length delta would
    // misreport this ordinary ability play as losing a hull.
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'a1', type: 'ability', vehicleType: null, name: 'Ransack', materialCost: 10000 })], deck: [] } } })
    const after = applied(g, { type: 'PLAY_ABILITY_CARD', instanceId: 'a1' })
    expect(describeOutcome(g, after, 'b')).not.toContain('lose')

    // A genuine vehicle landing in the destroyed pile must still be reported.
    const before2 = makeGame({ activePlayer: BOT, turnNumber: 3 })
    const after2 = makeGame({ activePlayer: BOT, turnNumber: 3 })
    after2.state.destroyed.a.push(zoneEntry({ instanceId: 'v1', name: 'Rook', materialCost: 50000 }))
    expect(describeOutcome(before2, after2, 'b')).toContain('enemy loses 1 hull')
  })
})
