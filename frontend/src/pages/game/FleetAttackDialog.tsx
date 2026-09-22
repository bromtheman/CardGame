import type { ZoneState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import type { PublicGameState } from '@shared/engine/gameInit'
import { fleetAttackRosters } from '@shared/engine/index'
import { MiniVehicle } from './MiniVehicle'
import crosshairIcon from '../../assets/icons/crosshairSVG.svg'

// Fleet-attack confirmation. Since the 2026-09-16 amendment to spec §3.4
// there is nothing to pick: every hull of mine in the zone bar Inoffensive
// ones attacks, and every enemy hull there is attacked. The dialog shows the
// player exactly what ATTACK_ENEMY_FLEET will commit — read off the engine's
// own `fleetAttackRosters`, never re-derived here (docs/claude/frontend.md,
// "Never mirror engine logic") — and the two ways a DEFENDER may thin the
// roster before the battle locks: Stealthy ("may withdraw") and a printed
// omission condition ("may sit out"), both answered in StealthyResponseBar.
export function FleetAttackDialog({
  state,
  zone,
  mySide,
  turnNumber,
  send,
  busy,
  onClose,
}: {
  state: PublicGameState
  zone: ZoneState
  mySide: Side
  turnNumber: number
  send: (action: GameAction) => Promise<void>
  busy: boolean
  onClose: () => void
}) {
  const rosters = fleetAttackRosters(state, mySide, zone.id, turnNumber)
  const force = rosters?.force ?? []
  const targets = rosters?.targets ?? []
  const mine = zone.cards[mySide] as ZoneCardEntry[]
  // Everything of mine NOT in the force, not only the Inoffensive ones —
  // fleetAttackRosters also drops a stunned hull (2026-09-21 LH spec §3.4),
  // and it used to vanish from the dialog entirely rather than show up here.
  const benched = mine.filter((c) => !force.some((f) => f.instanceId === c.instanceId))

  async function onLaunch() {
    await send({ type: 'ATTACK_ENEMY_FLEET', zoneId: zone.id })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80 p-4">
      <div className="w-full max-w-2xl rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank">
        <h2 className="font-display text-2xl">Attack fleet — Zone {zone.id}</h2>
        <p className="mt-1 text-sm text-ocean-300">
          Every vehicle able to attack goes in, against every enemy vehicle in the zone.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-ocean-300">Your attackers ({force.length})</p>
            <div className="mt-2 flex min-h-[90px] flex-wrap content-start gap-1">
              {force.map((c) => (
                <MiniVehicle key={c.instanceId} entry={c} turnNumber={turnNumber} selected />
              ))}
              {benched.map((c) => (
                <div key={c.instanceId} className="flex w-20 shrink-0 flex-col items-center">
                  <MiniVehicle entry={c} turnNumber={turnNumber} dimmed />
                  <span className="mt-0.5 text-[10px] text-ocean-300">Sits out</span>
                </div>
              ))}
              {force.length === 0 && benched.length === 0 && (
                <p className="text-sm text-ocean-300">No vehicles here.</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm text-ocean-300">Enemy targets ({targets.length})</p>
            <div className="mt-2 flex min-h-[90px] flex-wrap content-start gap-1">
              {targets.map((c) => {
                const stealthy = rosters?.stealthyIds.includes(c.instanceId) ?? false
                const omissible = rosters?.omissibleIds.includes(c.instanceId) ?? false
                return (
                  <div key={c.instanceId} className="flex w-20 shrink-0 flex-col items-center">
                    <MiniVehicle entry={c} turnNumber={turnNumber} selected />
                    {stealthy && (
                      <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-ocean-300">
                        <img src={crosshairIcon} alt="stealthy" className="h-3 w-3" />
                        <span>may withdraw</span>
                      </div>
                    )}
                    {!stealthy && omissible && (
                      <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-ocean-300">
                        <img src={crosshairIcon} alt="omissible" className="h-3 w-3" />
                        <span>may sit out</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {targets.length === 0 && <p className="text-sm text-ocean-300">No vehicles here.</p>}
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
            disabled={busy || force.length === 0 || targets.length === 0}
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
