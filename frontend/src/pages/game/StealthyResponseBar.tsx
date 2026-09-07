import { useState } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'

import { ConcedeButton } from './ConcedeButton'

// The defender's window while a fleet attack awaits their withdrawal response
// (state.awaitingResponse). The aggressor just waits; the defender checks off
// which of their own targets step out before RESPOND_TO_ATTACK either locks
// the battle or calls it off.
//
// Two kinds of target may step out, and they are listed together but labelled
// apart (spec §4.8): a Stealthy hull withdraws unconditionally, while an
// omissible one (Buzzsaw and Veles until the 2026-09-02 pass; no seeded card
// today, only frozen in-flight snapshots) may only sit out because this
// particular attacking force holds no ship or tank. The engine decides which
// is which; this component never re-derives the condition.
//
// ⚠ THE TWO HALVES ARE DELIBERATELY DIFFERENT SHAPES.
//
// The DEFENDER'S half is a modal: it is a decision the game is blocked on, and
// as a top banner it read as an announcement — players missed that anything
// was being asked of them and sat waiting for the other captain, who was
// waiting for them. A modal with a backdrop is the same affordance every other
// pending decision on this board uses (PendingChoiceDialog, ConfirmDialog).
//
// The AGGRESSOR'S half stays a banner. They have no decision to make and every
// board action is frozen anyway; a modal would black out the board they are
// waiting to see change, to tell them to wait.
export function StealthyResponseBar({
  state,
  mySide,
  send,
  busy,
  onConcede,
}: {
  state: PublicGameState
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
  onConcede: () => void
}) {
  const pending = state.awaitingResponse
  const [optOutIds, setOptOutIds] = useState<string[]>([])

  if (!pending) return null

  if (pending.aggressor === mySide) {
    return (
      <div className="fixed inset-x-0 top-0 z-40 bg-brass-400 p-3 text-center font-bold text-ocean-950 shadow-plank">
        Fleet attack declared in zone {pending.zoneId} — waiting on the enemy to decide whether any of their
        vehicles step out…
      </div>
    )
  }

  const zone = state.zones.find((z) => z.id === pending.zoneId)
  // Defaulted for a row written before wave 4, the same way normalizeState
  // defaults it server-side.
  const omissibleIds = pending.omissibleIds ?? []
  const mine = (zone?.cards[mySide] as ZoneCardEntry[] | undefined) ?? []
  const optional = mine
    .filter((c) => pending.stealthyIds.includes(c.instanceId) || omissibleIds.includes(c.instanceId))
    .map((c) => ({ entry: c, stealthy: pending.stealthyIds.includes(c.instanceId) }))

  function toggle(id: string) {
    setOptOutIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function onConfirm() {
    await send({ type: 'RESPOND_TO_ATTACK', optOutIds })
  }

  return (
    // No click-through-to-dismiss on the backdrop and no Escape handler, unlike
    // ConfirmDialog: there is nothing to cancel to. The battle is frozen until
    // this answers, so the only ways out are Confirm and Concede.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Zone ${pending.zoneId} under attack`}
        className="w-full max-w-lg rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank"
      >
        <h2 className="font-display text-2xl">Zone {pending.zoneId} under attack</h2>
        <p className="mt-1 text-sm text-ocean-300">
          {optional.length === 0
            ? 'None of your vehicles here can step out. Confirm to let the battle lock.'
            : 'Any of these may step out before the battle locks — the rest of your fleet fights.'}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {optional.map(({ entry: c, stealthy }) => (
            <label
              key={c.instanceId}
              className="flex cursor-pointer items-center gap-2 rounded border border-ocean-600 px-3 py-2 text-sm text-parchment-100"
            >
              <input
                type="checkbox"
                checked={optOutIds.includes(c.instanceId)}
                onChange={() => toggle(c.instanceId)}
              />
              <span className="font-bold">{c.name}</span>
              <span className="text-ocean-300">({stealthy ? 'withdraw' : 'sit out'})</span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-ocean-600/50 pt-4">
          {/* The escape hatch travels with the thing that blocks the board —
              see ConcedeButton. */}
          <ConcedeButton onConcede={onConcede} busy={busy} />
          <button
            disabled={busy}
            onClick={onConfirm}
            autoFocus
            className="ml-auto rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50"
          >
            {optOutIds.length === 0 ? 'Fight with everything' : `Withdraw ${optOutIds.length}, fight with the rest`}
          </button>
        </div>
      </div>
    </div>
  )
}
