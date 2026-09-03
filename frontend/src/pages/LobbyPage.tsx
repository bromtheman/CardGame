import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { DEFAULT_LOBBY_SETTINGS, materialsPerTurnOf, validateLobbySettings } from '@shared/lobbySettings'
import type { LobbySettings } from '@shared/lobbySettings'
import { MAX_MATERIALS_PER_TURN, MIN_MATERIALS_PER_TURN, ZONE_TYPES } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import { BoardPreview } from '../components/BoardPreview'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useAuth } from '../lib/auth'
import { useDecksQuery } from '../lib/decks'
import { useUsernames } from '../lib/games'
import { canStart, lobbyAction, lobbyVerdict, seatOf, useLobbyQuery } from '../lib/lobbies'
import { useRealtimeInvalidate } from '../lib/realtime'
import { supabase } from '../lib/supabaseClient'

export function LobbyPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = session?.user.id ?? ''

  const { data: lobby, isLoading } = useLobbyQuery(id)
  const { data: decks } = useDecksQuery()
  useRealtimeInvalidate('lobby-room', 'lobbies', [['lobby', id]], `id=eq.${id}`)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  // Set before any self-initiated exit so the verdict effect stays quiet —
  // a host who cancels their own lobby must not be told "The host closed the
  // lobby", and a guest who leaves must not be told they were removed.
  const leavingRef = useRef(false)
  // The one bit of history the row cannot carry: without it a kicked guest
  // looks exactly like a stranger browsing an open lobby.
  const wasSeatedRef = useRef(false)

  // LobbyRow structurally satisfies LobbySeats once Task 3's types land, so
  // these pass straight through — no cast.
  const seat = lobby ? seatOf(lobby, me) : null
  if (seat !== null) wasSeatedRef.current = true

  const { data: names } = useUsernames([lobby?.host_id, lobby?.guest_id])

  useEffect(() => {
    if (isLoading || leavingRef.current) return
    const verdict = lobbyVerdict(lobby ?? null, me, wasSeatedRef.current)
    if (verdict.kind === 'to-game') {
      navigate(`/game/${verdict.gameId}`, { replace: true })
    } else if (verdict.kind === 'ejected') {
      navigate('/lobbies', { replace: true, state: { notice: verdict.notice } })
    }
  }, [lobby, isLoading, me, navigate])

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lobby', id] })

  const setDeck = (deckId: string) => run(async () => {
    await lobbyAction({ action: 'SET_DECK', lobbyId: id!, deckId })
    await refresh()
  })

  const setReady = (ready: boolean) => run(async () => {
    await lobbyAction({ action: 'SET_READY', lobbyId: id!, ready })
    await refresh()
  })

  const updateSettings = (settings: LobbySettings) => run(async () => {
    const checked = validateLobbySettings(settings)
    if ('errors' in checked) throw new Error(checked.errors.join('; '))
    await lobbyAction({ action: 'UPDATE_SETTINGS', lobbyId: id!, settings: checked.settings })
    await refresh()
  })

  const kick = () => run(async () => {
    await lobbyAction({ action: 'KICK', lobbyId: id! })
    await refresh()
  })

  const join = () => run(async () => {
    await lobbyAction({ action: 'JOIN', lobbyId: id! })
    await refresh()
  })

  const leave = () => run(async () => {
    leavingRef.current = true
    await lobbyAction({ action: 'LEAVE', lobbyId: id! })
    navigate('/lobbies', { replace: true })
  })

  const cancel = () => run(async () => {
    leavingRef.current = true
    const { error: deleteError } = await supabase.from('lobbies').delete().eq('id', id!)
    if (deleteError) { leavingRef.current = false; throw deleteError }
    navigate('/lobbies', { replace: true })
  })

  // The fast path for the host. The verdict effect above would get them there
  // anyway once game_id arrives over realtime — this just skips the wait, and
  // means a dropped response leaves the host no worse off than the guest.
  const start = () => run(async () => {
    const result = await lobbyAction({ action: 'START', lobbyId: id! })
    if (result?.gameId) navigate(`/game/${result.gameId}`, { replace: true })
  })

  if (isLoading) return <main className="p-8 text-center text-ocean-300">Loading lobby…</main>
  if (!lobby) return <main className="p-8 text-center text-ocean-300">Lobby not found.</main>

  const isHost = seat === 'host'
  const settings = 'errors' in validateLobbySettings(lobby.settings)
    ? DEFAULT_LOBBY_SETTINGS
    : (validateLobbySettings(lobby.settings) as { settings: LobbySettings }).settings

  if (seat === null) {
    const open = lobby.status === 'open' && !lobby.guest_id
    return (
      <main className="mx-auto max-w-2xl p-6">
        <Link to="/lobbies" className="text-sm text-ocean-300 hover:text-brass-400">← Harbor</Link>
        <h1 className="mt-3 font-display text-3xl">{lobby.name}</h1>
        <div className="mt-4"><BoardPreview settings={settings} /></div>
        {error && <p className="mt-2 text-red-400">{error}</p>}
        {open ? (
          <button disabled={busy} onClick={join}
            className="mt-4 rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            Take the free seat
          </button>
        ) : (
          <p className="mt-4 text-ocean-300">That lobby is full or closed.</p>
        )}
      </main>
    )
  }

  const myDeckId = (isHost ? lobby.host_deck_id : lobby.guest_deck_id) ?? ''
  const myReady = isHost ? lobby.host_ready : lobby.guest_ready
  // Off the LOBBY row, never from `decks` — decks_select_own means the
  // opponent's deck row is unreadable by this client (spec §3.1.1).
  const theirFaction = (isHost ? lobby.guest_faction : lobby.host_faction) ?? undefined

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col gap-3 p-4">
      {/* Command strip, in the hidden NavBar's place — same shape as the
          game board's, so the two full-screen routes read alike. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-ocean-600 bg-ocean-900/95 px-3 py-1.5">
        <Link to="/lobbies" title="Back to the harbor" className="text-sm text-ocean-300 hover:text-brass-400">
          ← Harbor
        </Link>
        <h1 className="font-display text-lg leading-tight">{lobby.name}</h1>
        <span className="text-sm text-ocean-300">{isHost ? 'Host' : 'Challenger'}</span>
        <span className="ml-auto rounded-full bg-ocean-800 px-2.5 py-0.5 text-sm text-ocean-300">
          {!lobby.guest_id
            ? 'Waiting for a challenger'
            : canStart(lobby) ? 'Ready to launch' : 'Waiting on ready checks'}
        </span>
      </header>

      {error && <p className="text-red-400">{error}</p>}

      <div className="grid gap-3 md:grid-cols-[1.15fr_1fr]">
        <section className="flex flex-col gap-2">
          <Seat
            label="Host" name={names?.get(lobby.host_id) ?? '…'} ready={lobby.host_ready}
            mine={isHost} decks={decks ?? []} deckId={isHost ? myDeckId : ''}
            faction={isHost ? undefined : theirFaction}
            onDeck={setDeck} busy={busy}
          />
          {lobby.guest_id ? (
            <Seat
              label="Challenger" name={names?.get(lobby.guest_id) ?? '…'} ready={lobby.guest_ready}
              mine={!isHost} decks={decks ?? []} deckId={!isHost ? myDeckId : ''}
              faction={isHost ? theirFaction : undefined}
              onDeck={setDeck} busy={busy}
              onKick={isHost ? kick : undefined}
            />
          ) : (
            <div className="rounded border border-dashed border-ocean-600 bg-ocean-900/40 p-6 text-center text-ocean-300">
              An empty berth. Share this page's link to fill it.
            </div>
          )}
        </section>

        <section className="rounded border border-ocean-600 bg-ocean-900/60 p-3">
          <h2 className="text-sm text-ocean-300">Battlefield</h2>
          <div className="mt-2"><BoardPreview settings={settings} /></div>
          <div className="mt-3 border-t border-ocean-600 pt-3">
            {isHost ? (
              <SettingsEditor settings={settings} busy={busy} onChange={updateSettings} />
            ) : (
              <dl className="flex flex-col gap-1 text-sm text-ocean-300">
                <div className="flex justify-between">
                  <dt>Base HP</dt>
                  <dd className="text-parchment-100">
                    {settings.zones.map((z) => shortHandNumber(z.baseHp)).join(' / ')}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Resources / turn</dt>
                  <dd className="text-parchment-100">
                    {shortHandNumber(materialsPerTurnOf(settings))} × turn
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isHost && (
          <button disabled={busy || !canStart(lobby)} onClick={start}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50">
            {busy ? 'Working…' : 'Start game'}
          </button>
        )}
        <button disabled={busy || (!myReady && !myDeckId)} onClick={() => setReady(!myReady)}
          className="rounded border border-ocean-600 px-4 py-2 text-parchment-100 disabled:opacity-50">
          {myReady ? 'Unready' : 'Ready'}
        </button>
        <div className="ml-auto">
          {isHost ? (
            <button disabled={busy} onClick={() => setConfirmCancel(true)} className="text-red-400 underline">
              Cancel lobby
            </button>
          ) : (
            <button disabled={busy} onClick={leave} className="text-red-400 underline">
              Leave lobby
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this lobby?"
        body="The lobby closes for both of you and the berth is lost."
        confirmLabel="Cancel lobby"
        danger
        onConfirm={() => { setConfirmCancel(false); void cancel() }}
        onCancel={() => setConfirmCancel(false)}
      />
    </main>
  )
}

function Seat({ label, name, ready, mine, decks, deckId, faction, onDeck, busy, onKick }: {
  label: string
  name: string
  ready: boolean
  mine: boolean
  decks: { id: string; name: string; faction: string }[]
  deckId: string
  /** The opponent's faction, read off the lobby row. Their deck NAME is
      deliberately never shown — "anti-air rush" tells you what to mulligan
      for, with no way to un-see it — and is not even fetchable client-side. */
  faction?: string
  onDeck: (deckId: string) => void
  busy: boolean
  onKick?: () => void
}) {
  return (
    <div className={`rounded border p-3 ${ready ? 'border-brass-400' : 'border-ocean-600'} bg-ocean-900/60`}>
      <p className="text-xs text-ocean-300">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-bold text-parchment-100">{name}</span>
        {faction && (
          <span className="rounded-full bg-ocean-800 px-2 py-0.5 text-xs text-ocean-300">{faction}</span>
        )}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
          ready ? 'bg-brass-400 text-ocean-950' : 'bg-ocean-800 text-ocean-300'
        }`}>
          {ready ? 'Ready' : 'Not ready'}
        </span>
        {onKick && (
          <button onClick={onKick} disabled={busy} aria-label={`Remove ${name} from the lobby`}
            title="Remove from lobby" className="text-red-400 disabled:opacity-50">
            ×
          </button>
        )}
      </div>
      {mine && (
        <select className="mt-2 w-full rounded bg-ocean-950 p-2" value={deckId} disabled={busy}
          onChange={(e) => onDeck(e.target.value)}>
          <option value="">Your deck…</option>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.faction})</option>)}
        </select>
      )}
    </div>
  )
}

// Selects commit on change; number inputs commit on BLUR, so typing a
// five-digit HP value sends one request instead of five.
function SettingsEditor({ settings, busy, onChange }: {
  settings: LobbySettings
  busy: boolean
  onChange: (next: LobbySettings) => void
}) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  const commitZoneHp = (i: number, value: number) => {
    const next = { ...draft, zones: draft.zones.map((z, j) => (j === i ? { ...z, baseHp: value } : z)) }
    setDraft(next); onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      {draft.zones.map((zone, i) => (
        <div key={i} className="flex items-center gap-2 text-sm text-ocean-300">
          <span className="w-14">Zone {i + 1}</span>
          <select className="flex-1 rounded bg-ocean-950 p-1" value={zone.biome} disabled={busy}
            onChange={(e) => {
              const next = {
                ...draft,
                zones: draft.zones.map((z, j) =>
                  (j === i ? { ...z, biome: e.target.value as typeof z.biome } : z)),
              }
              setDraft(next); onChange(next)
            }}>
            {Object.values(ZONE_TYPES).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input type="number" className="w-24 rounded bg-ocean-950 p-1" disabled={busy}
            value={zone.baseHp}
            onChange={(e) => setDraft((d) => ({
              ...d, zones: d.zones.map((z, j) => (j === i ? { ...z, baseHp: Number(e.target.value) } : z)),
            }))}
            onBlur={(e) => commitZoneHp(i, Number(e.target.value))} />
        </div>
      ))}
      <label className="text-sm text-ocean-300">
        Resources / turn
        <input type="number" className="mt-1 block w-full rounded bg-ocean-950 p-1" disabled={busy}
          min={MIN_MATERIALS_PER_TURN} max={MAX_MATERIALS_PER_TURN} step={5000}
          value={materialsPerTurnOf(draft)}
          onChange={(e) => setDraft((d) => ({ ...d, materialsPerTurn: Number(e.target.value) }))}
          onBlur={(e) => {
            const next = { ...draft, materialsPerTurn: Number(e.target.value) }
            setDraft(next); onChange(next)
          }} />
        <span className="mt-1 block text-xs text-ocean-400">
          × turn number — {shortHandNumber(materialsPerTurnOf(draft))} on turn 1
        </span>
      </label>
    </div>
  )
}
