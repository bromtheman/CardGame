import { useState } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'

// Page-wide banner while a fleet attack awaits the defender's stealthy-
// withdrawal response (state.awaitingResponse). The aggressor just waits;
// the defender checks off which of their own Stealthy targets slip away
// before RESPOND_TO_ATTACK either locks the battle or calls it off.
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
        Fleet attack declared in zone {pending.zoneId} — waiting on the enemy to decide whether their stealthy
        vehicles withdraw…
      </div>
    )
  }

  const zone = state.zones.find((z) => z.id === pending.zoneId)
  const stealthyEntries =
    (zone?.cards[mySide] as ZoneCardEntry[] | undefined)?.filter((c) => pending.stealthyIds.includes(c.instanceId)) ??
    []

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
          Zone {pending.zoneId} under attack — withdraw any stealthy vehicles before the battle locks:
        </p>
        {stealthyEntries.map((c) => (
          <label key={c.instanceId} className="flex items-center gap-1 text-sm text-ocean-300">
            <input type="checkbox" checked={optOutIds.includes(c.instanceId)} onChange={() => toggle(c.instanceId)} />
            {c.name} (withdraw)
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
