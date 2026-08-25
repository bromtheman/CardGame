import { useState } from 'react'
import type { ZoneState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { baseDamageFrom } from '@shared/engine/index'
import { KEYWORDS } from '@shared/gameSettings'
import { FleetAttackDialog } from './FleetAttackDialog'

// Own-side zone footer actions: bombard the enemy base, or declare a fleet
// attack. Reasons a button is disabled are recomputed here purely for UX —
// the engine (baseAttack.ts / battleDeclare.ts) re-validates authoritatively
// and is the source of truth if this ever drifts.
export function ZoneActions({
  zone,
  mySide,
  theirSide,
  turnNumber,
  send,
  busy,
}: {
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
  const enemyHasBlocker = theirs.some((c) => c.keywords.includes(KEYWORDS.BLOCKER))
  const baseDestroyed = zone.baseHp[theirSide] <= 0
  const predictedDamage = baseDamageFrom(mine, turnNumber)

  let bombardReason: string | null = null
  if (activated) bombardReason = 'This zone was already activated this turn'
  else if (enemyHasBlocker) bombardReason = 'An enemy Blocker protects that base'
  else if (baseDestroyed) bombardReason = 'That base is already destroyed'
  else if (predictedDamage === 0) {
    bombardReason = 'No eligible strikers (subs, Inoffensive, and freshly deployed vehicles cannot strike)'
  }

  const canFleetAttack = !activated && mine.length > 0 && theirs.length > 0

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
        disabled={busy || !canFleetAttack}
        title={activated ? 'This zone was already activated this turn' : undefined}
        onClick={() => setFleetAttackOpen(true)}
        className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Attack fleet
      </button>
      {fleetAttackOpen && (
        <FleetAttackDialog
          zone={zone}
          mySide={mySide}
          theirSide={theirSide}
          turnNumber={turnNumber}
          send={send}
          busy={busy}
          onClose={() => setFleetAttackOpen(false)}
        />
      )}
    </div>
  )
}
