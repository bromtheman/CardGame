import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyAction, baseDamageFrom, baseStrikersIn } from './index'
import { registerEffect } from '../effects/registry'
import type { ZoneCardEntry } from './engineTypes'
import { makeCtx, makeGame, zoneEntry } from './testFixtures'

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

// ---------------------------------------------------------------------------
// Wave 4: a bombardment is not a battle, but it is the other half of
// Plunderer's one clause, so ATTACK_ENEMY_BASE dispatches onBattleVictory
// (spec §4.3, DP2 departure 5).
// ---------------------------------------------------------------------------

let raided: { card: string; phase: string; won: boolean; survived: boolean }[] = []

beforeAll(() => {
  registerEffect('t_raidSpy', ({ card, battle }) => {
    raided.push({
      card: card.name,
      phase: battle?.phase ?? 'none',
      won: battle?.won ?? false,
      survived: battle?.survived ?? false,
    })
    return true
  })
})

beforeEach(() => { raided = [] })

const raider = (over: Partial<ZoneCardEntry> = {}) =>
  zoneEntry({ materialCost: 40000, playedOnTurn: 2, meta: { onBattleVictory: 't_raidSpy' }, ...over })

describe('DP2 on a base bombardment', () => {
  it('fires onBattleVictory for a contributing vehicle, in the baseAttack phase', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(raider({ name: 'Plunderer' }))
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(raided).toEqual([{ card: 'Plunderer', phase: 'baseAttack', won: true, survived: true }])
  })

  // baseStrikersIn's roster, not everything standing in the zone: a hull that
  // dealt no damage did not inflict damage to the enemy base.
  it('does not fire for a sub, an Inoffensive hull, or one played this turn', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(
      raider({ name: 'Striker' }),
      raider({ name: 'Diver', vehicleType: 'sub' }),
      raider({ name: 'Pacifist', keywords: ['inoffensive'] }),
      raider({ name: 'Rookie', playedOnTurn: 3 }),
    )
    const r = applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(raided.map((x) => x.card)).toEqual(['Striker'])
  })

  it('does not fire when the bombardment is refused', () => {
    const g = makeGame({ turnNumber: 3 })
    g.state.zones[0].cards.a.push(raider({ name: 'Plunderer' }))
    g.state.zones[0].cards.b.push(zoneEntry({ keywords: ['blocker'] }))
    expect(applyAction(g, 'alice', { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, makeCtx()))
      .toMatchObject({ ok: false, status: 400 }) // an enemy Blocker protects that base
    expect(raided).toEqual([])
  })

  it('agrees with baseDamageFrom about who strikes', () => {
    const entries = [
      raider({ name: 'Striker' }),
      raider({ name: 'Diver', vehicleType: 'sub' }),
      raider({ name: 'Rookie', playedOnTurn: 3 }),
    ]
    expect(baseStrikersIn(entries, 3).map((c) => c.name)).toEqual(['Striker'])
    expect(baseDamageFrom(entries, 3)).toBe(40)
  })
})
