import { describe, expect, it } from 'vitest'
import { isMyMove } from './games'

const row = (state: Partial<Parameters<typeof isMyMove>[0]['state']>) => ({
  active_player: 'alice',
  player_a: 'alice',
  state: { awaitingResponse: null, pendingReport: null, pendingEffect: null, ...state },
})

describe('isMyMove', () => {
  it('is my move when I owe the pending choice', () => {
    expect(isMyMove(row({ pendingEffect: { side: 'a' } }), 'alice')).toBe(true)
  })

  it('is not my move when my opponent owes it', () => {
    expect(isMyMove(row({ pendingEffect: { side: 'b' } }), 'alice')).toBe(false)
  })

  it('a pending choice outranks the active player', () => {
    expect(isMyMove(row({ pendingEffect: { side: 'b' } }), 'alice')).toBe(false)
    expect(isMyMove(row({ pendingEffect: { side: 'b' } }), 'bob')).toBe(true)
  })

  it('still classifies a pending report and an awaited response', () => {
    expect(isMyMove(row({ pendingReport: { submittedBy: 'a' } }), 'alice')).toBe(false)
    expect(isMyMove(row({ awaitingResponse: { aggressor: 'a' } }), 'alice')).toBe(false)
  })

  it('falls back to the active player', () => {
    expect(isMyMove(row({}), 'alice')).toBe(true)
    expect(isMyMove(row({}), 'bob')).toBe(false)
  })
})
