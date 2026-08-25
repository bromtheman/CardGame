import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { Side } from '@shared/engine/engineTypes'
import type { LobbySettings } from '@shared/lobbySettings'
import { battleFrozen, legalZonesFor } from '@shared/engine/index'
import { shortHandNumber } from '@shared/format'
import { useGameQuery, useMyGamePlayerQuery, useUsernames } from '../../lib/games'
import { useRealtimeInvalidate } from '../../lib/realtime'
import { useAuth } from '../../lib/auth'
import { useGameActions } from './useGameActions'
import { BoardZone } from './BoardZone'
import { HandBar } from './HandBar'
import { ZoneActions } from './ZoneActions'
import { StealthyResponseBar } from './StealthyResponseBar'

export function GameBoardPage() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const { data: game, isLoading } = useGameQuery(id)
  const { data: mine } = useMyGamePlayerQuery(id)
  const { data: names } = useUsernames([game?.player_a, game?.player_b, game?.winner_id])
  useRealtimeInvalidate(`game-${id}`, 'games', [['game', id]], `id=eq.${id}`)
  useRealtimeInvalidate(`gp-${id}`, 'game_players', [['gamePlayer', id]], `game_id=eq.${id}`)
  const { send, busy, error } = useGameActions(game?.id, game?.version)
  const [placingCard, setPlacingCard] = useState<CardInstance | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const state = game?.state as unknown as PublicGameState | undefined
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [state?.log.length])

  if (isLoading) return <main className="p-8 text-center">Loading game…</main>
  if (!game || !state) {
    return <main className="p-8 text-center">Game not found (or you're not in it).</main>
  }

  const me = session?.user.id
  const mySide: Side = game.player_a === me ? 'a' : 'b'
  const theirSide: Side = mySide === 'a' ? 'b' : 'a'
  const opponentId = mySide === 'a' ? game.player_b : game.player_a
  const settings = game.settings as unknown as LobbySettings
  const hand = (mine?.hand ?? []) as unknown as CardInstance[]
  const isMyTurn = game.active_player === me
  const isActive = game.status === 'active'
  const legalForPlacing = placingCard ? legalZonesFor(state, mySide, placingCard) : []
  const canActivateZones = isMyTurn && isActive && !battleFrozen(state)

  function onEndTurn() {
    void send({ type: 'END_TURN' })
  }
  function onConcede() {
    if (!window.confirm('Concede this battle? You will lose immediately.')) return
    void send({ type: 'CONCEDE' })
  }
  function onZoneClick(zoneId: number) {
    if (!placingCard) return
    void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: placingCard.instanceId, zoneId })
    setPlacingCard(null)
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <StealthyResponseBar
        key={
          state.awaitingResponse
            ? `${state.awaitingResponse.zoneId}-${state.awaitingResponse.attackerIds.join(',')}`
            : 'none'
        }
        state={state}
        mySide={mySide}
        send={send}
        busy={busy}
      />
      <header className="flex flex-wrap items-center justify-between gap-3 rounded border border-ocean-600 bg-ocean-900/60 p-4">
        <div>
          <h1 className="font-display text-2xl">vs {names?.get(opponentId) ?? '…'}</h1>
          <p className="text-sm text-ocean-300">Turn {String(game.turn_number)}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 font-bold ${
            isMyTurn ? 'bg-brass-400 text-ocean-950' : 'bg-ocean-800 text-ocean-300'
          }`}
        >
          {isMyTurn ? 'Your turn' : 'Their turn'}
        </span>
        <div className="flex flex-wrap gap-4 text-sm text-ocean-300">
          <span>Materials: {shortHandNumber(state.resources[mySide].materials)}</span>
          <span>CP: {state.resources[mySide].cp}</span>
          <span>Opponent hand: {state.counts[theirSide].hand}</span>
          <span>Opponent deck: {state.counts[theirSide].deck}</span>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy || !isMyTurn || !isActive}
            onClick={onEndTurn}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50"
          >
            End turn
          </button>
          <button disabled={busy || !isActive} onClick={onConcede} className="text-red-400 underline disabled:opacity-50">
            Concede
          </button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {state.zones.map((zone) => (
          <BoardZone
            key={zone.id}
            zone={zone}
            maxBaseHp={settings.zones[zone.id - 1]?.baseHp ?? zone.baseHp[mySide]}
            mySide={mySide}
            theirSide={theirSide}
            turnNumber={game.turn_number}
            highlighted={legalForPlacing.includes(zone.id)}
            onZoneClick={legalForPlacing.includes(zone.id) ? () => onZoneClick(zone.id) : undefined}
          >
            {canActivateZones && (
              <ZoneActions
                zone={zone}
                mySide={mySide}
                theirSide={theirSide}
                turnNumber={game.turn_number}
                send={send}
                busy={busy}
              />
            )}
          </BoardZone>
        ))}
      </div>

      <HandBar
        hand={hand}
        state={state}
        mySide={mySide}
        send={send}
        busy={busy}
        placingCard={placingCard}
        onPlacingChange={setPlacingCard}
      />

      <h2 className="mt-4 font-display text-xl">Battle log</h2>
      <div ref={logRef} className="mt-1 h-40 overflow-y-auto rounded border border-ocean-600 bg-ocean-950/60 p-2 text-sm text-ocean-300">
        {state.log.slice(-30).map((entry, i) => <p key={i}>{entry}</p>)}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded border border-red-400 bg-ocean-950 p-3 text-red-300 shadow-plank">
          {error}
        </div>
      )}

      {game.status === 'complete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80">
          <div className="rounded-xl border-2 border-brass-400 bg-ocean-900 p-8 text-center shadow-plank">
            <h2 className="font-display text-3xl">
              {game.winner_id === me ? 'Victory!' : `${names?.get(game.winner_id ?? '') ?? 'Your opponent'} wins`}
            </h2>
            <Link to="/games" className="mt-4 inline-block rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950">
              Back to battles
            </Link>
          </div>
        </div>
      )}
    </main>
  )
}
