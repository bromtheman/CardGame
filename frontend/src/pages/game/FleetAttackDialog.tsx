import { useState } from 'react'
import type { ZoneState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { KEYWORDS } from '@shared/gameSettings'
import { MiniVehicle } from './MiniVehicle'
import crosshairIcon from '../../assets/icons/crosshairSVG.svg'

// Fleet-attack declaration modal: pick attackers from my stack in this zone
// and targets from theirs, then hand it to ATTACK_ENEMY_FLEET. Inoffensive
// vehicles of mine can't be picked as attackers. Any Stealthy target gets a
// "may withdraw" note — the engine opens a defender response window for
// those before the battle locks (see StealthyResponseBar).
export function FleetAttackDialog({
  zone,
  mySide,
  theirSide,
  turnNumber,
  send,
  busy,
  onClose,
}: {
  zone: ZoneState
  mySide: Side
  theirSide: Side
  turnNumber: number
  send: (action: GameAction) => Promise<void>
  busy: boolean
  onClose: () => void
}) {
  const [attackerIds, setAttackerIds] = useState<string[]>([])
  const [targetIds, setTargetIds] = useState<string[]>([])

  const mine = zone.cards[mySide] as ZoneCardEntry[]
  const theirs = zone.cards[theirSide] as ZoneCardEntry[]

  function toggle(ids: string[], setIds: (ids: string[]) => void, id: string) {
    setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  async function onLaunch() {
    await send({ type: 'ATTACK_ENEMY_FLEET', zoneId: zone.id, attackerIds, targetIds })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80 p-4">
      <div className="w-full max-w-2xl rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank">
        <h2 className="font-display text-2xl">Attack fleet — Zone {zone.id}</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-ocean-300">Your attackers</p>
            <div className="mt-2 flex min-h-[90px] flex-wrap content-start gap-1">
              {mine.map((c) => {
                const inoffensive = c.keywords.includes(KEYWORDS.INOFFENSIVE)
                return (
                  <MiniVehicle
                    key={c.instanceId}
                    entry={c}
                    turnNumber={turnNumber}
                    selected={attackerIds.includes(c.instanceId)}
                    dimmed={inoffensive}
                    onClick={inoffensive ? undefined : () => toggle(attackerIds, setAttackerIds, c.instanceId)}
                  />
                )
              })}
              {mine.length === 0 && <p className="text-sm text-ocean-300">No vehicles here.</p>}
            </div>
          </div>
          <div>
            <p className="text-sm text-ocean-300">Enemy targets</p>
            <div className="mt-2 flex min-h-[90px] flex-wrap content-start gap-1">
              {theirs.map((c) => {
                const stealthy = c.keywords.includes(KEYWORDS.STEALTHY)
                return (
                  <div key={c.instanceId} className="flex w-20 shrink-0 flex-col items-center">
                    <MiniVehicle
                      entry={c}
                      turnNumber={turnNumber}
                      selected={targetIds.includes(c.instanceId)}
                      onClick={() => toggle(targetIds, setTargetIds, c.instanceId)}
                    />
                    {stealthy && (
                      <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-ocean-300">
                        <img src={crosshairIcon} alt="stealthy" className="h-3 w-3" />
                        <span>may withdraw</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {theirs.length === 0 && <p className="text-sm text-ocean-300">No vehicles here.</p>}
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            disabled={busy}
            onClick={onClose}
            className="rounded border border-ocean-600 px-4 py-2 font-bold text-parchment-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            disabled={busy || attackerIds.length === 0 || targetIds.length === 0}
            onClick={onLaunch}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Launch attack
          </button>
        </div>
      </div>
    </div>
  )
}
