import { useQuery } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import type { LobbySettings } from '@shared/lobbySettings'
import type { Database } from './database.types'
import { supabase } from './supabaseClient'

export type LobbyRow = Database['public']['Tables']['lobbies']['Row']

// The narrow shape the pure functions below reason about. Deliberately NOT
// LobbyRow: these are the only columns the decisions turn on, and typing
// against the subset keeps the tests free of generated-type churn.
export interface LobbySeats {
  host_id: string
  guest_id: string | null
  host_deck_id: string | null
  guest_deck_id: string | null
  host_ready: boolean
  guest_ready: boolean
  status: string
  game_id: string | null
}

export type LobbyVerdict =
  | { kind: 'waiting' }
  | { kind: 'to-game'; gameId: string }
  | { kind: 'ejected'; notice: string }
  | { kind: 'joinable' }
  | { kind: 'unavailable'; notice: string }

export function seatOf(lobby: LobbySeats, myId: string): 'host' | 'guest' | null {
  if (lobby.host_id === myId) return 'host'
  if (lobby.guest_id === myId) return 'guest'
  return null
}

// Where this player belongs, given the latest row. The page acts on the
// verdict; it never decides for itself. `wasSeated` is the one bit of history
// the row cannot carry — without it, a kicked guest is indistinguishable from
// a stranger browsing an open lobby.
export function lobbyVerdict(
  lobby: LobbySeats | null,
  myId: string,
  wasSeated: boolean,
): LobbyVerdict {
  if (!lobby) {
    return wasSeated
      ? { kind: 'ejected', notice: 'The host closed the lobby.' }
      : { kind: 'unavailable', notice: 'That lobby no longer exists.' }
  }

  if (seatOf(lobby, myId) !== null) {
    // game_id is checked before status because a started lobby is 'closed' —
    // reading status first would eject both players at the moment of victory.
    if (lobby.game_id) return { kind: 'to-game', gameId: lobby.game_id }
    if (lobby.status === 'closed') {
      return { kind: 'ejected', notice: 'That lobby is no longer open.' }
    }
    return { kind: 'waiting' }
  }

  // Ordered ahead of 'joinable' on purpose: a kicked guest is looking at an
  // open lobby with a free seat, and must be told what happened rather than
  // silently offered the seat back.
  if (wasSeated) return { kind: 'ejected', notice: 'You were removed from the lobby.' }

  if (lobby.status === 'open' && !lobby.guest_id) return { kind: 'joinable' }
  return { kind: 'unavailable', notice: 'That lobby is full or closed.' }
}

// Mirrors the conditions in lobby-action's START lock. Advisory only — the
// server re-checks every one of them inside the statement that takes the
// mutex, so a stale client can never start a game it shouldn't.
export function canStart(lobby: LobbySeats): boolean {
  return (
    lobby.status === 'open' &&
    !!lobby.host_deck_id &&
    !!lobby.guest_id &&
    !!lobby.guest_deck_id &&
    lobby.host_ready &&
    lobby.guest_ready
  )
}

export function useLobbyQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['lobby', id],
    enabled: !!id,
    queryFn: async (): Promise<LobbyRow | null> => {
      const { data, error } = await supabase
        .from('lobbies').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export interface LobbyActionBody {
  action: 'JOIN' | 'LEAVE' | 'START' | 'SET_DECK' | 'SET_READY' | 'UPDATE_SETTINGS' | 'KICK'
  lobbyId: string
  deckId?: string
  ready?: boolean
  settings?: LobbySettings
}

export async function lobbyAction(body: LobbyActionBody) {
  const { data, error } = await supabase.functions.invoke('lobby-action', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const parsed = await error.context.json().catch(() => null)
      throw new Error(parsed?.errors?.join('; ') ?? error.message)
    }
    throw error
  }
  return data
}
