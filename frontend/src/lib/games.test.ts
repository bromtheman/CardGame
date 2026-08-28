import { describe, expect, it, vi } from 'vitest'
import { isMyMove } from './games'

// games.ts imports supabaseClient for its query hooks, and that module throws
// at import time when the Vite env vars are absent — which they are under the
// root vitest config, since it has no envDir and .env.local is gitignored.
// isMyMove is pure, so stubbing the client keeps this file honest and keeps
// `npx vitest run` green on a clean checkout.
vi.mock('./supabaseClient', () => ({ supabase: {} }))

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
