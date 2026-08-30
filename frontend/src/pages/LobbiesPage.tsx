import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import {
  DEFAULT_LOBBY_SETTINGS, materialsPerTurnOf, validateLobbySettings,
} from '@shared/lobbySettings'
import type { LobbySettings } from '@shared/lobbySettings'
import {
  MAX_MATERIALS_PER_TURN, MIN_MATERIALS_PER_TURN, ZONE_TYPES,
} from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import type { Database } from '../lib/database.types'
import { useDecksQuery } from '../lib/decks'
import { useGamesQuery } from '../lib/games'
import { useRealtimeInvalidate } from '../lib/realtime'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'

type LobbyRow = Database['public']['Tables']['lobbies']['Row']

// Compact settings readout so browsers see what they'd be joining.
function settingsSummary(settings: unknown): string {
  const parsed = validateLobbySettings(settings)
  if ('errors' in parsed) return 'custom settings'
  const zones = parsed.settings.zones
    .map((z) => `${z.biome} ${shortHandNumber(z.baseHp)}`)
    .join(' / ')
  return `${zones} · ${shortHandNumber(materialsPerTurnOf(parsed.settings))}/turn`
}

async function lobbyAction(body: { action: string; lobbyId: string; deckId?: string }) {
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

export function LobbiesPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: decks } = useDecksQuery()
  const [name, setName] = useState('')
  const [deckId, setDeckId] = useState('')
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_LOBBY_SETTINGS)
  const [joinDeckId, setJoinDeckId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: lobbies } = useQuery({
    queryKey: ['lobbies'],
    queryFn: async (): Promise<LobbyRow[]> => {
      const { data, error: qError } = await supabase
        .from('lobbies').select('*').order('created_at', { ascending: false })
      if (qError) throw qError
      return data
    },
  })
  // Lobby events also refresh games so a guest sees the freshly created
  // game (their lobby flips open→closed at START) without polling.
  useRealtimeInvalidate('lobbies-browser', 'lobbies', [['lobbies'], ['games']])
  useRealtimeInvalidate('lobbies-games', 'games', [['games']])
  const { data: games } = useGamesQuery()

  const me = session?.user.id
  // Only open/starting lobbies count as "mine in progress" — closed rows are
  // history and must never take over this page.
  const myLobby = (lobbies ?? []).find(
    (l) =>
      (l.host_id === me || l.guest_id === me) &&
      (l.status === 'open' || l.status === 'starting'),
  )
  const activeGames = (games ?? []).filter((g) => g.status === 'active')
  const openLobbies = (lobbies ?? []).filter((l) => l.status === 'open' && l.host_id !== me)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const createLobby = () => run(async () => {
    if (!me || !deckId) throw new Error('Pick a deck first')
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40) throw new Error('Name must be 1-40 characters')
    const checked = validateLobbySettings(settings)
    if ('errors' in checked) throw new Error(checked.errors.join('; '))
    const { error: insertError } = await supabase.from('lobbies').insert({
      host_id: me, name: trimmed, host_deck_id: deckId,
      settings: settings as unknown as Database['public']['Tables']['lobbies']['Insert']['settings'],
    })
    if (insertError) throw insertError
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const join = (lobby: LobbyRow) => run(async () => {
    if (!joinDeckId) throw new Error('Pick a deck to join with')
    await lobbyAction({ action: 'JOIN', lobbyId: lobby.id, deckId: joinDeckId })
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const leave = (lobby: LobbyRow) => run(async () => {
    await lobbyAction({ action: 'LEAVE', lobbyId: lobby.id })
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const cancel = (lobby: LobbyRow) => run(async () => {
    const { error: deleteError } = await supabase.from('lobbies').delete().eq('id', lobby.id)
    if (deleteError) throw deleteError
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
  })

  const start = (lobby: LobbyRow) => run(async () => {
    const result = await lobbyAction({ action: 'START', lobbyId: lobby.id })
    navigate(`/game/${result.gameId}`)
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-3xl">Harbor</h1>
      {error && <p className="mt-2 text-red-400">{error}</p>}

      {activeGames.length > 0 && (
        <section className="mt-3 flex flex-wrap items-center gap-3 rounded border border-brass-400 bg-ocean-900/60 p-3">
          <span className="font-bold">
            {activeGames.length === 1 ? 'You have an active battle!' : `${activeGames.length} active battles`}
          </span>
          {activeGames.slice(0, 3).map((g) => (
            <button key={g.id} onClick={() => navigate(`/game/${g.id}`)}
              className="rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950">
              Enter game
            </button>
          ))}
        </section>
      )}

      {myLobby ? (
        <section className="mt-4 rounded border border-brass-400 bg-ocean-900/60 p-4">
          <h2 className="font-display text-2xl">{myLobby.name}</h2>
          <p className="text-sm text-ocean-300">{settingsSummary(myLobby.settings)}</p>
          <p className="mt-1 text-ocean-300">
            {myLobby.guest_id && myLobby.guest_deck_id
              ? myLobby.host_id === me ? 'Opponent ready!' : 'Waiting for the host to start…'
              : 'Waiting for an opponent…'}
          </p>
          <div className="mt-3 flex gap-3">
            {myLobby.host_id === me && (
              <>
                <button disabled={busy || !myLobby.guest_id || !myLobby.guest_deck_id}
                  onClick={() => start(myLobby)}
                  className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
                  {busy ? 'Working…' : 'Start game'}
                </button>
                <button disabled={busy} onClick={() => cancel(myLobby)} className="text-red-400 underline">
                  Cancel lobby
                </button>
              </>
            )}
            {myLobby.guest_id === me && (
              <button disabled={busy} onClick={() => leave(myLobby)} className="text-red-400 underline">
                Leave lobby
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
          <h2 className="font-display text-xl">Open a lobby</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="rounded bg-ocean-950 p-2" placeholder="Lobby name" value={name}
              onChange={(e) => setName(e.target.value)} />
            <select className="rounded bg-ocean-950 p-2" value={deckId}
              onChange={(e) => setDeckId(e.target.value)}>
              <option value="">Your deck…</option>
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.faction})</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {settings.zones.map((zone, i) => (
              <label key={i} className="text-sm text-ocean-300">
                Zone {i + 1}
                <select className="mt-1 block rounded bg-ocean-950 p-2" value={zone.biome}
                  onChange={(e) => setSettings((s) => ({
                    ...s,
                    zones: s.zones.map((z, j) => (j === i ? { ...z, biome: e.target.value as typeof z.biome } : z)),
                  }))}>
                  {Object.values(ZONE_TYPES).map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input type="number" className="mt-1 block w-24 rounded bg-ocean-950 p-2"
                  value={zone.baseHp}
                  onChange={(e) => setSettings((s) => ({
                    ...s,
                    zones: s.zones.map((z, j) => (j === i ? { ...z, baseHp: Number(e.target.value) } : z)),
                  }))} />
              </label>
            ))}
            <label className="text-sm text-ocean-300">
              Resources / turn
              <input type="number" className="mt-1 block w-32 rounded bg-ocean-950 p-2"
                min={MIN_MATERIALS_PER_TURN} max={MAX_MATERIALS_PER_TURN} step={5000}
                value={materialsPerTurnOf(settings)}
                onChange={(e) => setSettings((s) => ({
                  ...s, materialsPerTurn: Number(e.target.value),
                }))} />
              <span className="mt-1 block text-xs text-ocean-400">
                × turn number — {shortHandNumber(materialsPerTurnOf(settings))} on turn 1
              </span>
            </label>
          </div>
          <button disabled={busy} onClick={createLobby}
            className="mt-3 rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            Create lobby
          </button>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-xl">Open lobbies</h2>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-ocean-300">Join with:</span>
          <select className="rounded bg-ocean-950 p-2" value={joinDeckId}
            onChange={(e) => setJoinDeckId(e.target.value)}>
            <option value="">Your deck…</option>
            {(decks ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.faction})</option>
            ))}
          </select>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {openLobbies.map((l) => (
            <li key={l.id} className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-3">
              <span className="flex-1">
                <span className="font-display text-lg">{l.name}</span>
                <span className="ml-3 text-sm text-ocean-300">{settingsSummary(l.settings)}</span>
              </span>
              <button disabled={busy || !!myLobby} onClick={() => join(l)}
                className="rounded bg-brass-400 px-3 py-1 font-bold text-ocean-950 disabled:opacity-50">
                Join
              </button>
            </li>
          ))}
          {openLobbies.length === 0 && <p className="text-ocean-300">No open lobbies — start one!</p>}
        </ul>
      </section>
    </main>
  )
}
