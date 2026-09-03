import { useState } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'

// Page-wide banner while a fleet attack awaits the defender's withdrawal
// response (state.awaitingResponse). The aggressor just waits; the defender
// checks off which of their own targets step out before RESPOND_TO_ATTACK
// either locks the battle or calls it off.
//
// Two kinds of target may step out, and they are listed together but labelled
// apart (spec §4.8): a Stealthy hull withdraws unconditionally, while an
// omissible one (Buzzsaw and Veles until the 2026-09-02 pass; no seeded card
// today, only frozen in-flight snapshots) may only sit out because this
// particular attacking force holds no ship or tank. The engine decides which
// is which; this component never re-derives the condition.
export function StealthyResponseBar({
  state,
  mySide,
  send,
  busy,
}: {
  state: PublicGameState
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
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
    <div className="fixed inset-x-0 top-0 z-40 bg-ocean-900 p-3 shadow-plank">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <p className="font-bold text-parchment-100">
          Zone {pending.zoneId} under attack — any of these may step out before the battle locks:
        </p>
        {optional.map(({ entry: c, stealthy }) => (
          <label key={c.instanceId} className="flex items-center gap-1 text-sm text-ocean-300">
            <input type="checkbox" checked={optOutIds.includes(c.instanceId)} onChange={() => toggle(c.instanceId)} />
            {c.name} ({stealthy ? 'withdraw' : 'sit out'})
          </label>
        ))}
        <button
          disabled={busy}
          onClick={onConfirm}
          className="ml-auto rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50"
        >
          Confirm
        </button>
      </div>
    </div>
  )
}
