import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_LOBBY_SETTINGS, materialsPerTurnOf, validateLobbySettings,
} from '@shared/lobbySettings'
import type { LobbySettings } from '@shared/lobbySettings'
import { shortHandNumber } from '@shared/format'
import type { Database } from '../lib/database.types'
import { useGamesQuery, useUsernames } from '../lib/games'
import { lobbyAction } from '../lib/lobbies'
import { BoardPreview } from '../components/BoardPreview'
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

// A row must render even if its settings blob is malformed — the preview is
// decoration, not a gate on browsing.
function previewSettings(settings: unknown): LobbySettings {
  const parsed = validateLobbySettings(settings)
  return 'errors' in parsed ? DEFAULT_LOBBY_SETTINGS : parsed.settings
}

export function LobbiesPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const notice = (location.state as { notice?: string } | null)?.notice

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
  const { data: hostNames } = useUsernames((lobbies ?? []).map((l) => l.host_id))

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const createLobby = () => run(async () => {
    if (!me) throw new Error('Not signed in')
    if (myLobby) throw new Error('You already have a lobby in progress')
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40) throw new Error('Name must be 1-40 characters')
    // No deck and default settings: both are chosen inside the lobby now.
    const { data, error: insertError } = await supabase.from('lobbies').insert({
      host_id: me, name: trimmed,
      settings: DEFAULT_LOBBY_SETTINGS as unknown as Database['public']['Tables']['lobbies']['Insert']['settings'],
    }).select().single()
    if (insertError) throw insertError
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
    navigate(`/lobby/${data.id}`)
  })

  const join = (lobby: LobbyRow) => run(async () => {
    await lobbyAction({ action: 'JOIN', lobbyId: lobby.id })
    await queryClient.invalidateQueries({ queryKey: ['lobbies'] })
    navigate(`/lobby/${lobby.id}`)
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-3xl">Harbor</h1>
      {notice && (
        <p className="mt-2 rounded border border-ocean-600 bg-ocean-900/60 p-2 text-ocean-300">{notice}</p>
      )}
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

      {myLobby && (
        <section className="mt-4 rounded border border-brass-400 bg-ocean-900/60 p-4">
          <h2 className="font-display text-2xl">{myLobby.name}</h2>
          <p className="mt-1 text-ocean-300">You have a lobby in progress.</p>
          <Link to={`/lobby/${myLobby.id}`}
            className="mt-3 inline-block rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950">
            Return to lobby
          </Link>
        </section>
      )}

      {!myLobby && (
        <section className="mt-4 rounded border border-ocean-600 bg-ocean-900/60 p-4">
          <h2 className="font-display text-xl">Open a lobby</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="rounded bg-ocean-950 p-2" placeholder="Lobby name" value={name}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <button disabled={busy} onClick={createLobby}
            className="mt-3 rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            Create lobby
          </button>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-xl">Open lobbies</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {openLobbies.map((l) => (
            <li key={l.id} className="flex items-center gap-4 rounded border border-ocean-600 bg-ocean-900/60 p-3">
              <span className="w-28 shrink-0">
                <BoardPreview settings={previewSettings(l.settings)} size="sm" />
              </span>
              <span className="flex-1">
                <span className="font-display text-lg">{l.name}</span>
                <span className="ml-3 text-sm text-ocean-300">
                  {hostNames?.get(l.host_id) ?? '…'}
                </span>
                <span className="ml-3 text-sm text-ocean-300">{settingsSummary(l.settings)}</span>
              </span>
              <span className="rounded-full bg-ocean-800 px-2 py-0.5 text-xs text-ocean-300">
                {l.guest_id ? '2/2' : '1/2'}
              </span>
              <button disabled={busy || !!myLobby || !!l.guest_id} onClick={() => join(l)}
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
