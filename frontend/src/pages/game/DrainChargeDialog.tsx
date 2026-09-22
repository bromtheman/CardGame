import { useState } from 'react'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { ChargeShare, Side } from '@shared/engine/engineTypes'
import { chargeGateOf, chargeOf, chargePayersOf, chargeSplitError, suggestedChargeSplit } from '@shared/engine/index'
import { useEscapeToCancel } from '../../components/ConfirmDialog'
import { MiniVehicle } from './MiniVehicle'

// 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md §4).
// The last step of playing a Drain card whose split is a real choice: which
// of my LH hulls give up how much. It opens on the engine's suggested split
// and asks the engine's own validator about every change — nothing here
// re-derives a rule (docs/claude/frontend.md, "Never mirror engine logic").
export function DrainChargeDialog({
  state, mySide, turnNumber, card, busy, onPlay, onCancel,
}: {
  state: PublicGameState
  mySide: Side
  turnNumber: number
  card: CardInstance
  busy: boolean
  onPlay: (split: ChargeShare[]) => void
  onCancel: () => void
}) {
  const gate = chargeGateOf(card)
  const payers = chargePayersOf(state, mySide)
  const [taken, setTaken] = useState<Record<string, number>>(() =>
    Object.fromEntries((suggestedChargeSplit(state, mySide, gate) ?? []).map((s) => [s.instanceId, s.amount])))
  useEscapeToCancel(true, onCancel)

  const split: ChargeShare[] = payers
    .filter((p) => (taken[p.entry.instanceId] ?? 0) > 0)
    .map((p) => ({ instanceId: p.entry.instanceId, amount: taken[p.entry.instanceId] }))
  const chosen = split.reduce((sum, s) => sum + s.amount, 0)
  const problem = chargeSplitError(state, mySide, gate, split)
  const step = (instanceId: string, delta: 1 | -1, max: number) =>
    setTaken((cur) => ({ ...cur, [instanceId]: Math.min(max, Math.max(0, (cur[instanceId] ?? 0) + delta)) }))
  const zoneIds = [...new Set(payers.map((p) => p.zoneId))]
  const btn = 'inline-flex min-h-7 min-w-7 items-center justify-center font-bold leading-none disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Drain ${gate} charge for ${card.name}`}
        className="w-full max-w-2xl rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl">Drain {gate} charge for {card.name}</h2>
        <p className="mt-1 text-sm text-ocean-300">
          Choose which of your LH vehicles give up charge. Nothing is spent unless you play.
        </p>
        <div className="mt-4 space-y-3">
          {zoneIds.map((zoneId) => (
            <div key={zoneId}>
              <p className="text-sm text-ocean-300">Zone {zoneId}</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {payers.filter((p) => p.zoneId === zoneId).map(({ entry }) => {
                  const n = taken[entry.instanceId] ?? 0
                  const max = chargeOf(entry)
                  return (
                    <div key={entry.instanceId} className="flex flex-col items-center gap-1">
                      <MiniVehicle entry={entry} turnNumber={turnNumber} selected={n > 0} />
                      <span
                        role="group"
                        aria-label={`Charge taken from ${entry.name}`}
                        className="flex items-center gap-1 rounded-full border border-ocean-600 px-1 text-sm"
                      >
                        <button
                          type="button"
                          disabled={n <= 0}
                          aria-label={`Take one less charge from ${entry.name}`}
                          onClick={() => step(entry.instanceId, -1, max)}
                          className={btn}
                        >
                          −
                        </button>
                        <span className="min-w-[1.5ch] text-center font-bold tabular-nums">{n}</span>
                        <button
                          type="button"
                          disabled={n >= max}
                          aria-label={`Take one more charge from ${entry.name}`}
                          onClick={() => step(entry.instanceId, 1, max)}
                          className={btn}
                        >
                          +
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p className={`mt-4 text-sm font-bold ${chosen === gate ? 'text-ocean-300' : 'text-red-300'}`}>
          {chosen} of {gate} chosen
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-ocean-600 px-4 py-2 font-bold text-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || problem !== null}
            onClick={() => onPlay(split)}
            className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Play {card.name}
          </button>
        </div>
      </div>
    </div>
  )
}
