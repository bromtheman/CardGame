import { useState } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side } from '@shared/engine/engineTypes'
import { battleFrozen } from '@shared/engine/index'
import { HERO_POWER_DISTANCE_MOD_M } from '@shared/gameSettings'

// Move-mode shared between Rapid Redeployment (pick any own vehicle, then a
// legal zone) and the mobile-vehicle "move" affordance on MiniVehicle (skips
// straight to picking a zone for that one vehicle). GameBoardPage owns the
// actual state; this type just describes its shape for both consumers.
export type MoveMode =
  | { phase: 'pickVehicle' }
  | { phase: 'pickZone'; instanceId: string; kind: 'mobile' | 'heroPower' }

type UniversalPower = 'salvage' | 'tacticalPositioning' | 'draw' | 'rapidRedeployment'

// Header strip for the 4 universal hero powers (once-per-game, 1 CP each).
// Salvage opens an inline picker of my destroyed vehicles. Tactical
// Positioning also has a dedicated distance-nudge UI on BattleOverlay's
// spawn sheet; this button is a same-effect fallback via a prompt. Rapid
// Redeployment starts move-mode — GameBoardPage highlights legal zones on
// the board once a vehicle is picked.
export function HeroPowerBar({
  state, mySide, isMyTurn, isActive, send, busy, moveMode, onStartRapidRedeployment, onCancelMove,
}: {
  state: PublicGameState
  mySide: Side
  isMyTurn: boolean
  isActive: boolean
  send: (action: GameAction) => Promise<void>
  busy: boolean
  moveMode: MoveMode | null
  onStartRapidRedeployment: () => void
  onCancelMove: () => void
}) {
  const [salvageOpen, setSalvageOpen] = useState(false)
  const myDestroyedVehicles = state.destroyed[mySide].filter((c) => c.type === 'vehicle')

  function reasonFor(power: UniversalPower): string | null {
    if (!isActive) return 'Game is over'
    if (state.usedHeroPowers[mySide].includes(power)) return 'Already used this game'
    if (state.resources[mySide].cp < 1) return 'Not enough CP'
    if (power === 'tacticalPositioning') {
      if (!state.activeBattle) return 'No battle to reposition'
      if (state.pendingReport) return 'Resolve the pending report first'
      if (state.activeBattle.distanceModifiedBy.includes(mySide)) return 'You already adjusted this battle'
      return null
    }
    if (!isMyTurn) return 'Not your turn'
    if (battleFrozen(state)) return 'Resolve the battle first'
    if (power === 'salvage' && myDestroyedVehicles.length === 0) return 'No destroyed vehicles to salvage'
    return null
  }

  const reasons: Record<UniversalPower, string | null> = {
    salvage: reasonFor('salvage'),
    tacticalPositioning: reasonFor('tacticalPositioning'),
    draw: reasonFor('draw'),
    rapidRedeployment: reasonFor('rapidRedeployment'),
  }

  async function onDraw() {
    await send({ type: 'USE_HERO_POWER', power: 'draw' })
  }

  async function onTacticalFromHeader() {
    const raw = window.prompt(`Adjust the active battle's spawn distance by how many meters? (±${HERO_POWER_DISTANCE_MOD_M})`, '0')
    if (raw === null) return
    const parsed = Number(raw)
    const delta = Math.max(-HERO_POWER_DISTANCE_MOD_M, Math.min(HERO_POWER_DISTANCE_MOD_M, Number.isNaN(parsed) ? 0 : parsed))
    if (delta === 0) return
    await send({ type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: delta })
  }

  async function onSalvage(cardId: string) {
    await send({ type: 'USE_HERO_POWER', power: 'salvage', cardId })
    setSalvageOpen(false)
  }

  function onRapidRedeploymentClick() {
    if (moveMode) onCancelMove()
    else onStartRapidRedeployment()
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-ocean-600 bg-ocean-900/40 p-2">
      <span className="text-xs font-bold uppercase tracking-wide text-ocean-300">Hero powers</span>

      <div className="relative">
        <button
          disabled={busy || !!reasons.salvage}
          title={reasons.salvage ?? 'Return a destroyed vehicle to your hand'}
          onClick={() => setSalvageOpen((v) => !v)}
          className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvage (1 CP)
        </button>
        {salvageOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded border border-brass-400 bg-ocean-900 p-2 shadow-plank">
            {myDestroyedVehicles.length === 0 && <p className="text-xs text-ocean-300">No destroyed vehicles.</p>}
            {myDestroyedVehicles.map((c, i) => (
              <button
                key={`${c.cardId}-${i}`}
                disabled={busy}
                onClick={() => onSalvage(c.cardId)}
                className="block w-full rounded px-2 py-1 text-left text-sm text-parchment-100 hover:bg-ocean-800 disabled:opacity-50"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        disabled={busy || !!reasons.tacticalPositioning}
        title={reasons.tacticalPositioning ?? "Adjust the active battle's spawn distance"}
        onClick={onTacticalFromHeader}
        className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Tactical Positioning (1 CP)
      </button>

      <button
        disabled={busy || !!reasons.draw}
        title={reasons.draw ?? 'Draw a card'}
        onClick={onDraw}
        className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Hero Power Draw (1 CP)
      </button>

      <button
        disabled={busy || (!!reasons.rapidRedeployment && !moveMode)}
        title={reasons.rapidRedeployment ?? 'Move a friendly vehicle to any other zone legal for it'}
        onClick={onRapidRedeploymentClick}
        className={`rounded border px-3 py-1 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
          moveMode ? 'border-brass-400 bg-brass-400/20 text-brass-400' : 'border-ocean-600 text-parchment-100'
        }`}
      >
        Rapid Redeployment (1 CP)
      </button>

      {moveMode && (
        <span className="ml-auto flex items-center gap-2 text-sm text-brass-400">
          {moveMode.phase === 'pickVehicle'
            ? 'Pick one of your vehicles on the board to redeploy…'
            : 'Choose a highlighted zone, or cancel.'}
          <button onClick={onCancelMove} className="rounded border border-ocean-600 px-2 py-0.5 text-xs text-parchment-100">
            Cancel
          </button>
        </span>
      )}
    </div>
  )
}
