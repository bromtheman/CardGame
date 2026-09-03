import { describe, expect, it, vi } from 'vitest'
import type { LobbySeats } from './lobbies'
import { canStart, lobbyVerdict, seatOf } from './lobbies'

// lobbies.ts imports supabaseClient for its query hooks, and that module throws
// at import time when the Vite env vars are absent — which they are under the
// root vitest config, since it has no envDir and .env.local is gitignored.
// The pure functions are independent of Supabase, so stubbing the client
// keeps this file honest and keeps `npx vitest run` green on a clean checkout.
vi.mock('./supabaseClient', () => ({ supabase: {} }))

const HOST = 'host-uuid'
const GUEST = 'guest-uuid'
const STRANGER = 'stranger-uuid'

function lobby(over: Partial<LobbySeats> = {}): LobbySeats {
  return {
    host_id: HOST,
    guest_id: GUEST,
    host_deck_id: 'deck-a',
    guest_deck_id: 'deck-b',
    host_ready: true,
    guest_ready: true,
    status: 'open',
    game_id: null,
    ...over,
  }
}

describe('lobbyVerdict', () => {
  it('sends the HOST to the game once game_id lands', () => {
    const v = lobbyVerdict(lobby({ status: 'closed', game_id: 'game-1' }), HOST, true)
    expect(v).toEqual({ kind: 'to-game', gameId: 'game-1' })
  })

  // The whole point of R-3: the guest reaches the board by the same path,
  // without pressing anything.
  it('sends the GUEST to the game once game_id lands', () => {
    const v = lobbyVerdict(lobby({ status: 'closed', game_id: 'game-1' }), GUEST, true)
    expect(v).toEqual({ kind: 'to-game', gameId: 'game-1' })
  })

  it('keeps a seated player waiting while the lobby is open', () => {
    expect(lobbyVerdict(lobby(), GUEST, true)).toEqual({ kind: 'waiting' })
  })

  it('keeps a seated player waiting through the starting lock', () => {
    expect(lobbyVerdict(lobby({ status: 'starting' }), GUEST, true)).toEqual({ kind: 'waiting' })
  })

  it('ejects a guest who was kicked', () => {
    const v = lobbyVerdict(lobby({ guest_id: null, guest_deck_id: null, guest_ready: false }), GUEST, true)
    expect(v).toEqual({ kind: 'ejected', notice: 'You were removed from the lobby.' })
  })

  // A kicked guest is looking at an open lobby with a free seat — the exact
  // shape that reads as 'joinable'. wasSeated has to win, or being kicked
  // silently offers you a Join button instead of telling you what happened.
  it('prefers ejected over joinable for a kicked guest', () => {
    const v = lobbyVerdict(lobby({ guest_id: null, guest_deck_id: null }), GUEST, true)
    expect(v.kind).toBe('ejected')
  })

  it('ejects everyone when the row is gone', () => {
    const v = lobbyVerdict(null, GUEST, true)
    expect(v).toEqual({ kind: 'ejected', notice: 'The host closed the lobby.' })
  })

  it('ejects a seated player from a lobby that closed without a game', () => {
    const v = lobbyVerdict(lobby({ status: 'closed' }), HOST, true)
    expect(v).toEqual({ kind: 'ejected', notice: 'That lobby is no longer open.' })
  })

  it('offers a stranger the free seat of an open lobby', () => {
    expect(lobbyVerdict(lobby({ guest_id: null }), STRANGER, false)).toEqual({ kind: 'joinable' })
  })

  it('tells a stranger a full lobby is unavailable', () => {
    const v = lobbyVerdict(lobby(), STRANGER, false)
    expect(v).toEqual({ kind: 'unavailable', notice: 'That lobby is full or closed.' })
  })

  it('tells a stranger a closed lobby is unavailable', () => {
    const v = lobbyVerdict(lobby({ guest_id: null, status: 'closed' }), STRANGER, false)
    expect(v.kind).toBe('unavailable')
  })
})

describe('canStart', () => {
  it('allows a start when both seats are decked and ready', () => {
    expect(canStart(lobby())).toBe(true)
  })

  it('refuses without a guest', () => {
    expect(canStart(lobby({ guest_id: null, guest_deck_id: null, guest_ready: false }))).toBe(false)
  })

  it('refuses without a host deck', () => {
    expect(canStart(lobby({ host_deck_id: null }))).toBe(false)
  })

  it('refuses without a guest deck', () => {
    expect(canStart(lobby({ guest_deck_id: null }))).toBe(false)
  })

  it('refuses when the host has not readied', () => {
    expect(canStart(lobby({ host_ready: false }))).toBe(false)
  })

  it('refuses when the guest has not readied', () => {
    expect(canStart(lobby({ guest_ready: false }))).toBe(false)
  })

  it('refuses once the lobby has left open', () => {
    expect(canStart(lobby({ status: 'starting' }))).toBe(false)
  })
})

describe('seatOf', () => {
  it('names each seat', () => {
    expect(seatOf(lobby(), HOST)).toBe('host')
    expect(seatOf(lobby(), GUEST)).toBe('guest')
    expect(seatOf(lobby(), STRANGER)).toBe(null)
  })
})
