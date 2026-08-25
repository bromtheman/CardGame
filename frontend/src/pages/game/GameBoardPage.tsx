import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { Side } from '@shared/engine/engineTypes'
import type { LobbySettings } from '@shared/lobbySettings'
import { battleFrozen, biomeAllows, findVehicle, legalZonesFor } from '@shared/engine/index'
import { shortHandNumber } from '@shared/format'
import { useGameQuery, useMyGamePlayerQuery, useUsernames } from '../../lib/games'
import { useRealtimeInvalidate } from '../../lib/realtime'
import { useAuth } from '../../lib/auth'
import { useGameActions } from './useGameActions'
import { BoardZone } from './BoardZone'
import { HandBar } from './HandBar'
import { ZoneActions } from './ZoneActions'
import { StealthyResponseBar } from './StealthyResponseBar'
import { BattleOverlay } from './BattleOverlay'
import { HeroPowerBar, type MoveMode, type SwapMode } from './HeroPowerBar'

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
  const [moveMode, setMoveMode] = useState<MoveMode | null>(null)
  const [fieldTargeting, setFieldTargeting] = useState<CardInstance | null>(null)
  const [swapMode, setSwapMode] = useState<SwapMode | null>(null)
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
  // Vehicles only deploy where legalZonesFor says; a zone-targeted ability
  // (playOnZoneEffect) may target any zone, so every zone highlights for it.
  const legalForPlacing = placingCard
    ? placingCard.type === 'vehicle'
      ? legalZonesFor(state, mySide, placingCard)
      : state.zones.map((z) => z.id)
    : []
  const canActivateZones = isMyTurn && isActive && !battleFrozen(state)

  // Move-mode: shared zone-picking step for Rapid Redeployment (any own
  // vehicle) and the mobile-vehicle "move" affordance (Mobile keyword only).
  // Legal zones mirror heroPowers.ts's moveEntry — any zone but the current
  // one whose biome fits the vehicle, no screen-blocking check (that only
  // applies to playing a new card from hand, not relocating one already out).
  const moveSource = moveMode?.phase === 'pickZone' ? findVehicle(state, moveMode.instanceId) : null
  const legalForMove = moveSource
    ? state.zones
        .filter((z) => z.id !== moveSource.zone.id && biomeAllows(moveSource.entry.vehicleType, z.biome))
        .map((z) => z.id)
    : []
  const interactiveZoneIds = placingCard ? legalForPlacing : moveMode?.phase === 'pickZone' ? legalForMove : []

  // Swap-mode (DWG's Boarding Party): mirrors move-mode's two-step shape.
  // Once an own ship is picked, only enemy ships in that same zone become
  // clickable — a display-only filter; the server re-validates zone and cost.
  const swapOwnVehicle = swapMode?.phase === 'pickEnemy' ? findVehicle(state, swapMode.ownInstanceId) : null

  // Placing/fieldTargeting/moveMode/swapMode are mutually exclusive: starting
  // one clears the others. HandBar's handTargeting is internal to that
  // component, but it watches these same modes (via props) to clear itself
  // when one of them starts, and calls cancelAllModes (passed down) before
  // entering its own targeting mode.
  function cancelAllModes() {
    setPlacingCard(null)
    setMoveMode(null)
    setFieldTargeting(null)
    setSwapMode(null)
  }
  function onPlacingChange(card: CardInstance | null) {
    if (card) cancelAllModes()
    setPlacingCard(card)
  }
  function onFieldTargetingChange(card: CardInstance | null) {
    if (card) cancelAllModes()
    setFieldTargeting(card)
  }
  function onStartRapidRedeployment() {
    cancelAllModes()
    setMoveMode({ phase: 'pickVehicle' })
  }
  function onPickVehicleForMove(instanceId: string) {
    setMoveMode({ phase: 'pickZone', instanceId, kind: 'heroPower' })
  }
  function onMobileMoveClick(instanceId: string) {
    cancelAllModes()
    setMoveMode({ phase: 'pickZone', instanceId, kind: 'mobile' })
  }
  function onCancelMove() {
    setMoveMode(null)
  }
  function onFieldTargetClick(targetInstanceId: string) {
    if (!fieldTargeting) return
    void send({ type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: fieldTargeting.instanceId, targetInstanceId })
    setFieldTargeting(null)
  }
  function onStartBoardingParty() {
    cancelAllModes()
    setSwapMode({ phase: 'pickOwn' })
  }
  function onCancelSwap() {
    setSwapMode(null)
  }
  function onPickOwnForSwap(instanceId: string) {
    setSwapMode({ phase: 'pickEnemy', ownInstanceId: instanceId })
  }
  function onPickEnemyForSwap(targetInstanceId: string) {
    if (swapMode?.phase !== 'pickEnemy') return
    void send({ type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: swapMode.ownInstanceId, targetInstanceId })
    setSwapMode(null)
  }

  function onEndTurn() {
    void send({ type: 'END_TURN' })
  }
  function onConcede() {
    if (!window.confirm('Concede this battle? You will lose immediately.')) return
    void send({ type: 'CONCEDE' })
  }
  function onZoneClick(zoneId: number) {
    if (placingCard) {
      void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: placingCard.instanceId, zoneId })
      setPlacingCard(null)
      return
    }
    if (moveMode?.phase === 'pickZone') {
      if (moveMode.kind === 'mobile') {
        void send({ type: 'MOVE_VEHICLE', instanceId: moveMode.instanceId, zoneId })
      } else {
        void send({ type: 'USE_HERO_POWER', power: 'rapidRedeployment', instanceId: moveMode.instanceId, zoneId })
      }
      setMoveMode(null)
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <StealthyResponseBar
        key={
          state.awaitingResponse
            ? `${state.awaitingResponse.zoneId}-${state.awaitingResponse.attackerIds.join(',')}-${state.awaitingResponse.targetIds.join(',')}`
            : 'none'
        }
        state={state}
        mySide={mySide}
        send={send}
        busy={busy}
      />
      <BattleOverlay
        key={
          state.activeBattle
            ? `${state.activeBattle.zoneId}-${state.activeBattle.attackerIds.join(',')}-${state.activeBattle.defenderIds.join(',')}`
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

      {state.alertCard && (
        <div className="mt-3 rounded border border-brass-400 bg-ocean-900/60 p-2 text-center text-sm font-bold text-brass-400">
          ⚠ {state.alertCard.name} revealed by {state.alertCard.side === mySide ? 'you' : 'your opponent'} — effect in
          progress
        </div>
      )}

      <HeroPowerBar
        state={state}
        mySide={mySide}
        isMyTurn={isMyTurn}
        isActive={isActive}
        send={send}
        busy={busy}
        hand={hand}
        moveMode={moveMode}
        onStartRapidRedeployment={onStartRapidRedeployment}
        onCancelMove={onCancelMove}
        swapMode={swapMode}
        onStartBoardingParty={onStartBoardingParty}
        onCancelSwap={onCancelSwap}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {state.zones.map((zone) => (
          <BoardZone
            key={zone.id}
            zone={zone}
            maxBaseHp={settings.zones[zone.id - 1]?.baseHp ?? zone.baseHp[mySide]}
            mySide={mySide}
            theirSide={theirSide}
            turnNumber={game.turn_number}
            highlighted={interactiveZoneIds.includes(zone.id)}
            onZoneClick={interactiveZoneIds.includes(zone.id) ? () => onZoneClick(zone.id) : undefined}
            canMoveVehicles={canActivateZones && !fieldTargeting && !placingCard && !swapMode}
            moveVehiclePickMode={moveMode?.phase === 'pickVehicle'}
            selectedForMoveId={moveMode?.phase === 'pickZone' ? moveMode.instanceId : null}
            onPickVehicleForMove={onPickVehicleForMove}
            onMobileMoveClick={onMobileMoveClick}
            fieldTargetingActive={!!fieldTargeting}
            onFieldTargetClick={onFieldTargetClick}
            swapPickOwnMode={swapMode?.phase === 'pickOwn'}
            swapPickEnemyMode={swapMode?.phase === 'pickEnemy' && zone.id === swapOwnVehicle?.zone.id}
            selectedForSwapOwnId={swapMode?.phase === 'pickEnemy' ? swapMode.ownInstanceId : null}
            onPickOwnForSwap={onPickOwnForSwap}
            onPickEnemyForSwap={onPickEnemyForSwap}
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
        onPlacingChange={onPlacingChange}
        fieldTargeting={fieldTargeting}
        onFieldTargetingChange={onFieldTargetingChange}
        moveMode={moveMode}
        swapMode={swapMode}
        cancelBoardModes={cancelAllModes}
        canReveal={canActivateZones}
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
