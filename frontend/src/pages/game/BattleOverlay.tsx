import { useState } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { effectiveMaterialCostOf, otherSide, repairCostOf } from '@shared/engine/index'
import {
  HERO_POWER_DISTANCE_MOD_M, IN_BATTLE_RESOURCE_RATE, KEYWORDS,
  REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT,
} from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'

type Battle = NonNullable<PublicGameState['activeBattle']>
type Report = NonNullable<PublicGameState['pendingReport']>
interface Participant { entry: ZoneCardEntry; side: Side }

// Mirrors battleResolve.ts's private participantsOf() — the engine doesn't
// export it, so we rebuild the same {entry, side} pairs from the zone's
// card lists and the battle's attacker/defender id lists.
function participantsOf(state: PublicGameState, battle: Battle): Participant[] {
  const zone = state.zones.find((z) => z.id === battle.zoneId)
  if (!zone) return []
  const defenderSide = otherSide(battle.aggressor)
  const attackers = battle.attackerIds
    .map((id) => (zone.cards[battle.aggressor] as ZoneCardEntry[]).find((c) => c.instanceId === id))
    .filter((c): c is ZoneCardEntry => !!c)
    .map((entry): Participant => ({ entry, side: battle.aggressor }))
  const defenders = battle.defenderIds
    .map((id) => (zone.cards[defenderSide] as ZoneCardEntry[]).find((c) => c.instanceId === id))
    .filter((c): c is ZoneCardEntry => !!c)
    .map((entry): Participant => ({ entry, side: defenderSide }))
  return [...attackers, ...defenders]
}

function outcomeLabel(entry: ZoneCardEntry, hp: number, repaired: boolean): { label: string; survives: boolean } {
  if (hp >= SURVIVE_HP_PERCENT) return { label: 'Survives', survives: true }
  if (hp >= REPAIR_WINDOW_MIN_PERCENT && repaired) {
    return { label: `Repaired — survives (${shortHandNumber(repairCostOf(entry))})`, survives: true }
  }
  return { label: 'Destroyed', survives: false }
}

function FleetColumn({ title, entries, mySide }: { title: string; entries: Participant[]; mySide: Side }) {
  return (
    <div>
      <p className="font-display text-lg">{title}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {entries.map(({ entry, side }) => (
          <li key={entry.instanceId} className="rounded border border-ocean-600 bg-ocean-950/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-parchment-100">
                {entry.name}
                {side === mySide ? ' (yours)' : ''}
              </span>
              <span className="shrink-0 rounded-full bg-ocean-900 px-2 py-0.5 text-xs font-bold text-parchment-100">
                {shortHandNumber(effectiveMaterialCostOf(entry))}
              </span>
            </div>
            <p className="text-xs text-ocean-300">
              In-battle resources: {shortHandNumber(Math.floor(effectiveMaterialCostOf(entry) * IN_BATTLE_RESOURCE_RATE))}
            </p>
            {entry.keywords.includes(KEYWORDS.ROBOTIC) && (
              <p className="mt-1 text-xs text-brass-400">
                Robotic — unlimited in-battle repair resources, but destroyed if any of its sub-objects are destroyed.
              </p>
            )}
          </li>
        ))}
        {entries.length === 0 && <p className="text-sm text-ocean-300">No vehicles.</p>}
      </ul>
    </div>
  )
}

function ReportForm({
  participants, results, repairs, state, busy, onHpChange, onToggleRepair, onSubmit,
}: {
  participants: Participant[]
  results: Record<string, number>
  repairs: string[]
  state: PublicGameState
  busy: boolean
  onHpChange: (id: string, hp: number) => void
  onToggleRepair: (id: string) => void
  onSubmit: () => void
}) {
  const owedBySide: Record<Side, number> = { a: 0, b: 0 }
  for (const id of repairs) {
    const p = participants.find((x) => x.entry.instanceId === id)
    if (p) owedBySide[p.side] += repairCostOf(p.entry)
  }
  return (
    <div className="mt-4 border-t border-ocean-600/50 pt-3">
      <h3 className="font-display text-lg">Battle report</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-ocean-300">
            <th className="pb-1 font-normal">Vehicle</th>
            <th className="pb-1 font-normal">HP %</th>
            <th className="pb-1 font-normal">Repair</th>
          </tr>
        </thead>
        <tbody>
          {participants.map(({ entry, side }) => {
            const hp = results[entry.instanceId] ?? 100
            const fragile = entry.keywords.includes(KEYWORDS.FRAGILE)
            const inBand = hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
            const repairable = inBand && !fragile
            const cost = repairCostOf(entry)
            const checked = repairs.includes(entry.instanceId)
            // Running per-side total of currently-checked repairs (plus this
            // one's own cost when it isn't checked yet) — checking several
            // repairs on the same side can exceed materials even when each
            // is individually affordable.
            const projectedOwed = owedBySide[side] + (checked ? 0 : cost)
            const affordable = state.resources[side].materials >= projectedOwed
            return (
              <tr key={entry.instanceId} className="border-t border-ocean-600/30">
                <td className="py-1 pr-2 text-parchment-100">{entry.name}</td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={hp}
                    onChange={(e) => {
                      const raw = e.target.value
                      const v = raw === '' ? 0 : Number(raw)
                      if (!Number.isNaN(v)) onHpChange(entry.instanceId, Math.max(0, Math.min(100, v)))
                    }}
                    className="w-16 rounded border border-ocean-600 bg-ocean-950 px-1 py-0.5 text-parchment-100"
                  />
                </td>
                <td className="py-1">
                  <label className={`flex items-center gap-1 ${repairable ? '' : 'opacity-40'}`}>
                    <input
                      type="checkbox"
                      disabled={!repairable}
                      checked={repairs.includes(entry.instanceId)}
                      onChange={() => onToggleRepair(entry.instanceId)}
                    />
                    <span className={`text-xs ${affordable ? 'text-ocean-300' : 'text-red-400'}`}>
                      {shortHandNumber(cost)} ({side.toUpperCase()} pays{affordable ? '' : ' — cannot afford'})
                    </span>
                  </label>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button
        disabled={busy}
        onClick={onSubmit}
        className="mt-3 rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50"
      >
        Submit battle report
      </button>
    </div>
  )
}

function DecisionPanel({
  participants, report, state, busy, onDecide,
}: {
  participants: Participant[]
  report: Report
  state: PublicGameState
  busy: boolean
  onDecide: (approve: boolean) => void
}) {
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of report.repairs) {
    const p = participants.find((x) => x.entry.instanceId === id)
    if (p) owed[p.side] += repairCostOf(p.entry)
  }
  return (
    <div className="mt-4 border-t border-ocean-600/50 pt-3">
      <h3 className="font-display text-lg">Report from player {report.submittedBy.toUpperCase()} — review outcomes</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {participants.map(({ entry }) => {
          const hp = report.results[entry.instanceId] ?? 0
          const repaired = report.repairs.includes(entry.instanceId)
          const { label, survives } = outcomeLabel(entry, hp, repaired)
          return (
            <li key={entry.instanceId} className="flex items-center justify-between rounded border border-ocean-600 bg-ocean-950/60 px-2 py-1">
              <span className="text-parchment-100">{entry.name} — {hp}%</span>
              <span className={survives ? 'text-brass-400' : 'text-red-400'}>{label}</span>
            </li>
          )
        })}
      </ul>
      {(['a', 'b'] as Side[]).map((side) =>
        owed[side] > state.resources[side].materials ? (
          <p key={side} className="mt-2 text-xs text-red-400">
            Player {side.toUpperCase()} cannot afford {shortHandNumber(owed[side])} in repairs — approving will fail.
          </p>
        ) : null,
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          disabled={busy}
          onClick={() => onDecide(false)}
          className="rounded border border-red-400 px-4 py-2 font-bold text-red-400 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          disabled={busy}
          onClick={() => onDecide(true)}
          className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  )
}

function WaitingNotice({ participants, report }: { participants: Participant[]; report: Report }) {
  return (
    <div className="mt-4 border-t border-ocean-600/50 pt-3">
      <p className="font-bold text-brass-400">Report submitted — waiting for the other captain to approve or reject.</p>
      <ul className="mt-2 space-y-1 text-sm text-ocean-300">
        {participants.map(({ entry }) => (
          <li key={entry.instanceId}>
            {entry.name} — {report.results[entry.instanceId] ?? 0}%
            {report.repairs.includes(entry.instanceId) ? ' (repair requested)' : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Modal that takes over the board whenever a fleet battle is active: the
// spawn sheet (what to spawn in FTD, at what distance, altitude guidance,
// robotic conduct notes, end conditions), the Tactical Positioning distance
// nudge, and — depending on state.pendingReport — either the report form,
// a read-only decision panel (the other captain approves/rejects), or a
// waiting notice (I'm the one who submitted). GameBoardPage remounts this
// component (via a key on the battle's identity) whenever a *new* battle
// starts, so this local form state never leaks from one battle into another.
export function BattleOverlay({
  state, mySide, send, busy,
}: {
  state: PublicGameState
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
}) {
  const battle = state.activeBattle
  const participants = battle ? participantsOf(state, battle) : []
  const [results, setResults] = useState<Record<string, number>>(() =>
    Object.fromEntries(participants.map((p): [string, number] => [p.entry.instanceId, 100])),
  )
  const [repairs, setRepairs] = useState<string[]>([])
  const [deltaInput, setDeltaInput] = useState(0)

  if (!battle) return null

  const zone = state.zones.find((z) => z.id === battle.zoneId)
  const defenderSide = otherSide(battle.aggressor)
  const attackers = participants.filter((p) => p.side === battle.aggressor)
  const defenders = participants.filter((p) => p.side === defenderSide)
  const report = state.pendingReport

  function onHpChange(id: string, hp: number) {
    setResults((r) => ({ ...r, [id]: hp }))
    const p = participants.find((x) => x.entry.instanceId === id)
    const inBand = hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
    const fragile = p?.entry.keywords.includes(KEYWORDS.FRAGILE) ?? false
    if (!inBand || fragile) setRepairs((rs) => rs.filter((x) => x !== id))
  }

  function onToggleRepair(id: string) {
    setRepairs((rs) => (rs.includes(id) ? rs.filter((x) => x !== id) : [...rs, id]))
  }

  async function onSubmitReport() {
    const validRepairs = repairs.filter((id) => {
      const p = participants.find((x) => x.entry.instanceId === id)
      if (!p) return false
      const hp = results[id] ?? 0
      return hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT && !p.entry.keywords.includes(KEYWORDS.FRAGILE)
    })
    await send({ type: 'SUBMIT_BATTLE_REPORT', results, repairs: validRepairs })
  }

  async function onDecide(approve: boolean) {
    await send({ type: 'DECIDE_BATTLE_REPORT', approve })
  }

  const usedTactical = state.usedHeroPowers[mySide].includes('tacticalPositioning')
  const alreadyAdjusted = battle.distanceModifiedBy.includes(mySide)
  const noCp = state.resources[mySide].cp < 1
  // Order matches HeroPowerBar's reasonFor(): used -> CP -> battle-specific
  // (no-battle is impossible here since `battle` is already non-null).
  let tacticalReason: string | null = null
  if (usedTactical) tacticalReason = 'Already used this game'
  else if (noCp) tacticalReason = 'Not enough CP'
  else if (report) tacticalReason = 'Resolve the pending report first'
  else if (alreadyAdjusted) tacticalReason = 'You already adjusted this battle'

  async function onApplyTactical() {
    const delta = Math.max(-HERO_POWER_DISTANCE_MOD_M, Math.min(HERO_POWER_DISTANCE_MOD_M, deltaInput))
    if (delta === 0) return
    await send({ type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: delta })
    setDeltaInput(0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ocean-950/80 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank">
        <h2 className="font-display text-2xl">
          Fleet battle — Zone {battle.zoneId}
          {zone && <span className="text-base capitalize text-ocean-300"> ({zone.biome})</span>}
        </h2>
        <p className="mt-1 text-sm text-ocean-300">
          Spawn distance: <span className="font-bold text-parchment-100">{battle.distanceM} m</span>
        </p>
        <p className="mt-2 text-sm text-ocean-300">
          Altitude guidance: surface ships and submarines spawn at the surface; aircraft spawn at 80 m; land vehicles
          spawn on land.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FleetColumn title="Attacker fleet" entries={attackers} mySide={mySide} />
          <FleetColumn title="Defender fleet" entries={defenders} mySide={mySide} />
        </div>

        <p className="mt-3 text-xs text-ocean-300">
          Fight it out in From The Depths. It ends when all participating vehicles are at ≤80% HP, 2 minutes pass
          without damage, or one side is incapacitated.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ocean-600/50 pt-3">
          <label className="text-sm text-ocean-300">Adjust distance (±{HERO_POWER_DISTANCE_MOD_M} m):</label>
          <input
            type="number"
            min={-HERO_POWER_DISTANCE_MOD_M}
            max={HERO_POWER_DISTANCE_MOD_M}
            value={deltaInput}
            disabled={!!tacticalReason || busy}
            onChange={(e) => {
              const raw = e.target.value
              const v = raw === '' ? 0 : Number(raw)
              if (!Number.isNaN(v)) {
                setDeltaInput(Math.max(-HERO_POWER_DISTANCE_MOD_M, Math.min(HERO_POWER_DISTANCE_MOD_M, v)))
              }
            }}
            className="w-24 rounded border border-ocean-600 bg-ocean-950 px-2 py-1 text-parchment-100 disabled:opacity-50"
          />
          <button
            disabled={busy || !!tacticalReason || deltaInput === 0}
            title={tacticalReason ?? undefined}
            onClick={onApplyTactical}
            className="rounded bg-brass-400 px-3 py-1 text-sm font-bold text-ocean-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Tactical Positioning (1 CP)
          </button>
        </div>

        {report ? (
          report.submittedBy === mySide ? (
            <WaitingNotice participants={participants} report={report} />
          ) : (
            <DecisionPanel participants={participants} report={report} state={state} busy={busy} onDecide={onDecide} />
          )
        ) : (
          <ReportForm
            participants={participants}
            results={results}
            repairs={repairs}
            state={state}
            busy={busy}
            onHpChange={onHpChange}
            onToggleRepair={onToggleRepair}
            onSubmit={onSubmitReport}
          />
        )}
      </div>
    </div>
  )
}
