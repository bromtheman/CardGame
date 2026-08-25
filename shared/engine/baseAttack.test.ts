import { describe, expect, it } from 'vitest'
import { applyAction } from './index'
import { makeGame, zoneEntry } from './testFixtures'

function armed(over: Record<string, unknown> = {}) {
  const g = makeGame({ turnNumber: 3 })
  g.state.zones[0].cards.a.push(zoneEntry({ materialCost: 40000, playedOnTurn: 2, ...over }))
  return g
}

describe('ATTACK_ENEMY_BASE', () => {
  it('deals floor(cost/1000) per eligible vehicle and spends the activation', () => {
    const g = armed()
    g.state.zones[0].cards.a.push(zoneEntry({ materialCost: 15500, playedOnTurn: 2 }))
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40 - 15)
    expect(r.game.state.zones[0].lastActivatedTurn).toBe(3)
    expect(applyAction(r.game, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 409 }) // once per half-turn
  })
  it('excludes subs, inoffensive, and freshly played vehicles', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(
      zoneEntry({ vehicleType: 'sub', playedOnTurn: 1 }),
      zoneEntry({ keywords: ['inoffensive'], playedOnTurn: 1 }),
      zoneEntry({ playedOnTurn: 3 }),
    )
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 }) // nothing eligible
  })
  it('is blocked by an enemy blocker and by a destroyed base', () => {
    const g = armed()
    g.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
    const g2 = armed()
    g2.state.zones[0].baseHp.b = 0
    expect(applyAction(g2, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('completes the game when a second zone falls', () => {
    const g = armed({ materialCost: 500000 }) // 500 damage
    g.state.zones[0].baseHp.b = 300
    g.state.zones[1].baseHp.b = 0 // already lost
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })
  it('requires presence in the zone', () => {
    const g = makeGame({ turnNumber: 3 })
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }))
      .toMatchObject({ ok: false, status: 400 })
  })
  it('halfCost vehicles strike at their effective (halved) weight', () => {
    const g = armed({ materialCost: 80000, keywords: ['halfCost'] })
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].baseHp.b).toBe(1000 - 40) // floor(40000/1000)
  })
})
