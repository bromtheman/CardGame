import { describe, expect, it } from 'vitest'
import { LOG_MAX_ENTRIES } from '../gameSettings'
import { applyAction, normalizeState } from './index'
import { inst, makeGame, zoneEntry } from './testFixtures'

describe('guards', () => {
  it('rejects non-participants and finished games', () => {
    const g = makeGame()
    expect(applyAction(g, 'mallory', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 403 })
    const done = makeGame({ status: 'complete' })
    expect(applyAction(done, 'alice', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
  it('rejects turn actions from the non-active player', () => {
    const g = makeGame() // alice active
    expect(applyAction(g, 'bob', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
  it('never mutates its input', () => {
    const g = makeGame()
    const before = JSON.stringify(g)
    applyAction(g, 'alice', { type: 'END_TURN' })
    expect(JSON.stringify(g)).toBe(before)
  })
  it('freezes non-battle actions during a battle', () => {
    const g = makeGame()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: [],
    }
    expect(applyAction(g, 'alice', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('END_TURN', () => {
  it('advances 0.5, flips active player, SETS (not adds) income, draws', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.b.deck = [inst(), inst()]
    g.state.counts.b.deck = 2
    g.state.resources.b.materials = 12345 // sentinel: must be REPLACED, not added to
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.turnNumber).toBe(2.5)
    expect(r.game.activePlayer).toBe('bob')
    expect(r.game.state.resources.b.materials).toBe(100000) // floor(2.5) * 50k exactly
    expect(r.game.privates.b.hand).toHaveLength(1)
    expect(r.game.state.counts.b).toEqual({ hand: 1, deck: 1 })
  })
  it('culls temporary vehicles from both sides at turn start', () => {
    const g = makeGame()
    g.state.zones[0].cards.a.push(zoneEntry({ keywords: ['temporary'], playedOnTurn: 2 }))
    g.state.zones[0].cards.b.push(zoneEntry({}))
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.destroyed.a).toHaveLength(1) // culled temporaries are destroyed (salvageable)
  })
  it('skips the draw on an empty deck and logs it', () => {
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(0)
    expect(r.game.state.log.some((l) => l.includes('no cards left'))).toBe(true)
  })
  it('caps the action log at LOG_MAX_ENTRIES, keeping the newest entries', () => {
    const g = makeGame()
    g.privates.b.deck = [inst()] // avoid an extra "no cards left" log line from the draw
    g.state.counts.b.deck = 1
    for (let i = 0; i < 205; i++) g.state.log.push(`seed entry ${i}`)
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log.length).toBeLessThanOrEqual(LOG_MAX_ENTRIES)
    expect(r.game.state.log[r.game.state.log.length - 1]).toContain('Turn 2.5')
    expect(r.game.state.log[0]).not.toBe('seed entry 0')
    expect(r.game.state.log[r.game.state.log.length - 2]).toBe('seed entry 204')
  })
})

describe('CONCEDE', () => {
  it('ends the game with the other player winning, from either seat, even off-turn', () => {
    const g = makeGame()
    const r = applyAction(g, 'bob', { type: 'CONCEDE' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })
})

describe('normalizeState', () => {
  it('fills fields missing from pre-Phase-4 game rows', () => {
    const g = makeGame()
    const legacy = g.state as unknown as Record<string, unknown>
    delete legacy.awaitingResponse
    delete legacy.destroyed
    legacy.activeBattle = undefined
    ;(g.state.zones[0].cards.a as unknown[]).push({ ...inst() }) // no playedOnTurn
    normalizeState(g.state)
    expect(g.state.awaitingResponse).toBeNull()
    expect(g.state.activeBattle).toBeNull()
    expect(g.state.destroyed).toEqual({ a: [], b: [] })
    expect(g.state.zones[0].cards.a[0]).toMatchObject({ playedOnTurn: 0 })
    // normalized state passes the frozen check
    expect(applyAction(g, 'alice', { type: 'END_TURN' }).ok).toBe(true)
  })
})
