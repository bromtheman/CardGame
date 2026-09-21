import { useState } from 'react'
import type { PublicGameState, ZoneState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { activeBlockersIn, baseDamageFrom, fleetAttackRosters } from '@shared/engine/index'
import { FleetAttackDialog } from './FleetAttackDialog'

// Own-side zone footer actions: bombard the enemy base, or declare a fleet
// attack. Reasons a button is disabled are recomputed here purely for UX —
// the engine (baseAttack.ts / battleDeclare.ts) re-validates authoritatively
// and is the source of truth if this ever drifts.
export function ZoneActions({
  state,
  zone,
  mySide,
  theirSide,
  turnNumber,
  send,
  busy,
}: {
  state: PublicGameState
  zone: ZoneState
  mySide: Side
  theirSide: Side
  turnNumber: number
  send: (action: GameAction) => Promise<void>
  busy: boolean
}) {
  const [fleetAttackOpen, setFleetAttackOpen] = useState(false)

  const mine = zone.cards[mySide] as ZoneCardEntry[]
  const theirs = zone.cards[theirSide] as ZoneCardEntry[]
  const activated = zone.lastActivatedTurn === turnNumber
  const enemyHasBlocker = activeBlockersIn(theirs, turnNumber).length > 0
  const baseDestroyed = zone.baseHp[theirSide] <= 0
  const predictedDamage = baseDamageFrom(mine, turnNumber)

  let bombardReason: string | null = null
  if (activated) bombardReason = 'This zone was already activated this turn'
  else if (enemyHasBlocker) bombardReason = 'An enemy Blocker protects that base'
  else if (baseDestroyed) bombardReason = 'That base is already destroyed'
  else if (predictedDamage === 0) {
    bombardReason = 'No eligible strikers (subs, Inoffensive, and freshly deployed vehicles cannot strike)'
  }

  // The engine's own derivation (spec §3.4 as amended 2026-09-16: no roster to
  // pick), so the button and ATTACK_ENEMY_FLEET agree on what "can attack" means.
  const rosters = fleetAttackRosters(state, mySide, zone.id, turnNumber)
  let fleetReason: string | null = null
  if (activated) fleetReason = 'This zone was already activated this turn'
  else if (!rosters || rosters.targets.length === 0) fleetReason = 'No enemy vehicles here'
  else if (rosters.force.length === 0) fleetReason = 'No vehicle of yours here can attack (Inoffensive)'

  function onBombard() {
    void send({ type: 'ATTACK_ENEMY_BASE', zoneId: zone.id })
  }

  return (
    <div className="flex flex-wrap gap-2 border-t border-ocean-600/50 pt-2">
      <button
        disabled={busy || !!bombardReason}
        title={bombardReason ?? `Predicted damage: ${predictedDamage}`}
        onClick={onBombard}
        className="rounded bg-brass-400 px-3 py-1 text-sm font-bold text-ocean-950 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Bombard base{bombardReason ? '' : ` (${predictedDamage})`}
      </button>
      <button
        disabled={busy || !!fleetReason}
        title={fleetReason ?? undefined}
        onClick={() => setFleetAttackOpen(true)}
        className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Attack fleet
      </button>
      {fleetAttackOpen && (
        <FleetAttackDialog
          state={state}
          zone={zone}
          mySide={mySide}
          turnNumber={turnNumber}
          send={send}
          busy={busy}
          onClose={() => setFleetAttackOpen(false)}
        />
      )}
    </div>
  )
}
