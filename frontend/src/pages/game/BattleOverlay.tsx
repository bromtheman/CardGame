import { useState, type ReactNode } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import {
  autoRepairIds, battleParticipants, effectiveMaterialCostOf, otherSide, repairCostOf,
} from '@shared/engine/index'
import {
  HERO_POWER_DISTANCE_MOD_M, IN_BATTLE_RESOURCE_RATE, KEYWORDS,
  REPAIR_WINDOW_MIN_PERCENT, SURVIVE_HP_PERCENT,
} from '@shared/gameSettings'
import { AIRCRAFT_SPAWN_ALTITUDE_M } from '@shared/customBattle'
import { shortHandNumber } from '@shared/format'

import { LaunchInFtdButton } from './LaunchInFtdButton'
import { applyPrefill, prefillSummary, winnerLabel } from './ftdPrefill'
import type { FtdPrefill } from './ftdPrefill'
import { useFtdResultQuery } from './ftdReporting'
import { splitRosterBySide } from './reportTeams'

type Battle = NonNullable<PublicGameState['activeBattle']>
type Report = NonNullable<PublicGameState['pendingReport']>
interface Participant { entry: ZoneCardEntry; side: Side; isSummon: boolean }

// ⚠ THIS USED TO BE A HAND-WRITTEN MIRROR of battleResolve.ts's participantsOf,
// carrying a comment asking whoever changed the engine's copy to change this
// one too. That comment was not enough: wave 7 added a board-wide fallback to
// the engine for TG Duel's cross-zone battle and left this behind, so a duelled
// away-zone hull vanished from the overlay AND from the report this component
// builds — which the engine then rejected as not covering every vehicle,
// leaving the battle unreportable and the game stuck.
//
// It now calls the engine's own exported function, so the roster the UI shows
// and the roster the engine resolves cannot diverge. Do not reintroduce a copy.
// `isSummon` is the only thing added here, and it is derived from the same
// battle.summons list the engine reads (spec §4.4).
function participantsOf(state: PublicGameState, battle: Battle): Participant[] {
  const summonIds = new Set(battle.summons.map((s) => s.instanceId))
  return [...battleParticipants(state).values()].map(({ entry, side }) => ({
    entry, side, isSummon: summonIds.has(entry.instanceId),
  }))
}

function outcomeLabel(
  entry: ZoneCardEntry, hp: number, repaired: boolean, auto: boolean,
): { label: string; survives: boolean } {
  if (hp >= SURVIVE_HP_PERCENT) return { label: 'Survives', survives: true }
  if (hp >= REPAIR_WINDOW_MIN_PERCENT && auto) {
    return { label: 'Auto-repaired (free) — survives', survives: true }
  }
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
        {entries.map(({ entry, side, isSummon }) => (
          <li key={entry.instanceId} className="rounded border border-ocean-600 bg-ocean-950/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-parchment-100">
                {entry.name}
                {side === mySide ? ' (yours)' : ''}
                {isSummon ? ' (summoned)' : ''}
              </span>
              <span className="shrink-0 rounded-full bg-ocean-900 px-2 py-0.5 text-xs font-bold text-parchment-100">
                {shortHandNumber(effectiveMaterialCostOf(entry))}
              </span>
            </div>
            <p className="text-xs text-ocean-300">
              In-battle resources: {shortHandNumber(Math.floor(effectiveMaterialCostOf(entry) * IN_BATTLE_RESOURCE_RATE))}
            </p>
            {isSummon && (
              <p className="mt-1 text-xs text-ocean-300/70">
                Summoned for this battle only — not on anyone's board, and vanishes when the report is approved
                regardless of HP. Cannot be repaired.
              </p>
            )}
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

// Every panel below lists vehicles by name, and two captains routinely field
// the *same* hull — a merged list leaves you unable to tell which "Abactor"
// just died. So all three split the roster the same way: your ships left of a
// rule, theirs right of it. On a narrow screen the columns stack and the rule
// becomes the horizontal one above "Their ships".
const TEAM_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2'
const THEIR_COLUMN = 'border-t border-ocean-600/50 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0'

function TeamColumn({ title, empty, className = '', children }: {
  title: string
  empty: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="font-bold text-parchment-100">{title}</p>
      {empty ? <p className="mt-1 text-sm text-ocean-300">No vehicles.</p> : children}
    </div>
  )
}

function ReportForm({
  participants, results, repairs, state, mySide, busy, onHpChange, onToggleRepair, onSubmit,
}: {
  participants: Participant[]
  results: Record<string, number>
  repairs: string[]
  state: PublicGameState
  mySide: Side
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
  // Single source of truth for which vehicles the engine will auto-repair —
  // mirrors DecisionPanel below, so the submitter's preview can never drift
  // from what SUBMIT_BATTLE_REPORT actually resolves to. Summons are
  // excluded from the roster handed in, matching DECIDE_BATTLE_REPORT
  // (spec §4.4) — autoRepairIds must never see one.
  const autoIds = autoRepairIds(participants.filter((p) => !p.isSummon), results)
  const { mine: myShips, theirs: theirShips } = splitRosterBySide(participants, mySide)

  // One row builder for both columns: which side a hull is on already decides
  // everything that differs (whose checkbox is live, who pays), so the split is
  // purely presentational and the two tables cannot fall out of step.
  const rowFor = ({ entry, side, isSummon }: Participant) => {
    const hp = results[entry.instanceId] ?? 100
    const fragile = entry.keywords.includes(KEYWORDS.FRAGILE)
    const inBand = hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
    const mine = side === mySide
    const isAuto = autoIds.includes(entry.instanceId)
    // A summon's repair checkbox must stay disabled (spec §4.4): the
    // engine rejects a summon repair with a 400, so an enabled
    // control would be a trap producing an error the player can't
    // act on.
    const repairable = inBand && !fragile && mine && !isAuto && !isSummon
    // "Their captain decides" implies a pending decision — only true
    // where a repair decision could genuinely be made. Otherwise (out
    // of band, Fragile, summoned, or already auto-repaired) show a
    // neutral dash.
    const theirsToDecide = inBand && !fragile && !mine && !isAuto && !isSummon
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
        <td className="py-1 pr-2 text-parchment-100">
          {entry.name}
          {isSummon && <span className="ml-1 text-xs text-ocean-300/60">(summoned)</span>}
        </td>
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
          {isAuto ? (
            <span className="text-xs text-brass-400">Auto-repaired (free)</span>
          ) : !mine ? (
            <span className="text-xs text-ocean-300/60">
              {theirsToDecide ? 'Their captain decides' : '—'}
            </span>
          ) : (
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
          )}
        </td>
      </tr>
    )
  }

  const tableOf = (entries: Participant[]) => (
    <table className="mt-1 w-full text-sm">
      <thead>
        <tr className="text-left text-ocean-300">
          <th className="pb-1 font-normal">Vehicle</th>
          <th className="pb-1 font-normal">HP %</th>
          <th className="pb-1 font-normal">Repair</th>
        </tr>
      </thead>
      <tbody>{entries.map((p) => rowFor(p))}</tbody>
    </table>
  )

  return (
    <div className="mt-4 border-t border-ocean-600/50 pt-3">
      <h3 className="font-display text-lg">Battle report</h3>
      <div className={`mt-2 ${TEAM_GRID}`}>
        <TeamColumn title="Your ships" empty={myShips.length === 0}>{tableOf(myShips)}</TeamColumn>
        <TeamColumn title="Their ships" empty={theirShips.length === 0} className={THEIR_COLUMN}>
          {tableOf(theirShips)}
        </TeamColumn>
      </div>
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
  participants, report, state, mySide, busy, onDecide,
}: {
  participants: Participant[]
  report: Report
  state: PublicGameState
  mySide: Side
  busy: boolean
  onDecide: (approve: boolean, repairs: string[]) => void
}) {
  const [myRepairs, setMyRepairs] = useState<string[]>([])
  // Summons are excluded from the roster handed in, matching
  // DECIDE_BATTLE_REPORT (spec §4.4) — autoRepairIds must never see one.
  const auto = autoRepairIds(participants.filter((p) => !p.isSummon), report.results)
  const owed: Record<Side, number> = { a: 0, b: 0 }
  for (const id of new Set([...report.repairs, ...myRepairs, ...auto])) {
    const p = participants.find((x) => x.entry.instanceId === id)
    if (p) owed[p.side] += repairCostOf(p.entry)
  }
  const { mine: myShips, theirs: theirShips } = splitRosterBySide(participants, mySide)

  const itemFor = ({ entry, side, isSummon }: Participant) => {
    const hp = report.results[entry.instanceId] ?? 0
    const isAuto = auto.includes(entry.instanceId)
    const repaired = report.repairs.includes(entry.instanceId) || myRepairs.includes(entry.instanceId)
    // A summon evaporates regardless of HP (spec §4.4) — "Survives" or
    // "Destroyed" would both misstate what actually happens to it, so
    // this bypasses outcomeLabel entirely rather than teaching it a
    // third HP-independent case.
    const { label, survives } = isSummon
      ? { label: 'Summoned — evaporates', survives: false }
      : outcomeLabel(entry, hp, repaired, isAuto)
    const inBand = hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
    // A summon's repair checkbox must stay disabled (spec §4.4): the
    // engine rejects a summon repair with a 400, so an enabled control
    // would be a trap producing an error the player can't act on.
    const canChoose =
      side === mySide && inBand && !isAuto && !entry.keywords.includes(KEYWORDS.FRAGILE) && !isSummon
    return (
      <li key={entry.instanceId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border border-ocean-600 bg-ocean-950/60 px-2 py-1">
        <span className="text-parchment-100">
          {entry.name}{isSummon ? ' (summoned)' : ''} — {hp}%
        </span>
        <span className="flex items-center gap-3">
          {canChoose && (
            <label className="flex items-center gap-1 text-xs text-ocean-300">
              <input
                type="checkbox"
                checked={myRepairs.includes(entry.instanceId)}
                onChange={() =>
                  setMyRepairs((rs) =>
                    rs.includes(entry.instanceId)
                      ? rs.filter((x) => x !== entry.instanceId)
                      : [...rs, entry.instanceId],
                  )
                }
              />
              Repair ({shortHandNumber(repairCostOf(entry))})
            </label>
          )}
          <span className={isSummon ? 'text-ocean-300' : survives ? 'text-brass-400' : 'text-red-400'}>
            {label}
          </span>
        </span>
      </li>
    )
  }

  const listOf = (entries: Participant[]) => (
    <ul className="mt-1 space-y-1 text-sm">{entries.map((p) => itemFor(p))}</ul>
  )

  return (
    <div className="mt-4 border-t border-ocean-600/50 pt-3">
      <h3 className="font-display text-lg">Report from player {report.submittedBy.toUpperCase()} — review outcomes</h3>
      <div className={`mt-2 ${TEAM_GRID}`}>
        <TeamColumn title="Your ships" empty={myShips.length === 0}>{listOf(myShips)}</TeamColumn>
        <TeamColumn title="Their ships" empty={theirShips.length === 0} className={THEIR_COLUMN}>
          {listOf(theirShips)}
        </TeamColumn>
      </div>
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
          onClick={() => onDecide(false, [])}
          className="rounded border border-red-400 px-4 py-2 font-bold text-red-400 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          disabled={busy}
          onClick={() => onDecide(true, myRepairs)}
          className="rounded bg-brass-400 px-4 py-2 font-bold text-ocean-950 disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  )
}

function WaitingNotice({
  participants, report, mySide,
}: { participants: Participant[]; report: Report; mySide: Side }) {
  const { mine: myShips, theirs: theirShips } = splitRosterBySide(participants, mySide)
  const listOf = (entries: Participant[]) => (
    <ul className="mt-1 space-y-1 text-sm text-ocean-300">
      {entries.map(({ entry, isSummon }) => (
        <li key={entry.instanceId}>
          {entry.name}{isSummon ? ' (summoned)' : ''} — {report.results[entry.instanceId] ?? 0}%
          {report.repairs.includes(entry.instanceId) ? ' (repair requested)' : ''}
        </li>
      ))}
    </ul>
  )
  return (
    <div className="mt-4 border-t border-ocean-600/50 pt-3">
      <p className="font-bold text-brass-400">Report submitted — waiting for the other captain to approve or reject.</p>
      <div className={`mt-2 ${TEAM_GRID}`}>
        <TeamColumn title="Your ships" empty={myShips.length === 0}>{listOf(myShips)}</TeamColumn>
        <TeamColumn title="Their ships" empty={theirShips.length === 0} className={THEIR_COLUMN}>
          {listOf(theirShips)}
        </TeamColumn>
      </div>
    </div>
  )
}

/**
 * What the From The Depths mod reported, offered as a prefill.
 *
 * Deliberately a banner with a button rather than an automatic fill. The
 * numbers still go through a human and then through the opponent's approval —
 * that approval (DECIDE_BATTLE_REPORT's `actor === report.submittedBy` 403) is
 * the only thing making a reported result trustworthy, and nothing on this path
 * may route around it.
 */
function FtdResultBanner({
  prefill, note, factionOf, onApply,
}: {
  prefill: FtdPrefill
  note: string | null
  factionOf: (side: string) => string
  onApply: () => void
}) {
  const winner = winnerLabel(prefill, factionOf)
  const count = Object.keys(prefill.results ?? {}).length
  return (
    <div className="mt-4 rounded border border-brass-400/60 bg-ocean-950/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-brass-400">
            From The Depths reported this battle
          </p>
          <p className="text-xs text-ocean-300">
            {count} vehicle(s){winner ? ` — ${winner}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onApply}
          className="rounded bg-brass-400 px-3 py-1 text-sm font-bold text-ocean-950"
        >
          Fill in the report
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-ocean-300">{note}</p>}
      <p className="mt-2 text-xs text-ocean-300">
        Check the numbers before submitting — a vehicle the game removed mid-fight is reported
        at 0%, and your opponent still has to approve the report.
      </p>
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
  state, mySide, send, busy, gameId,
}: {
  state: PublicGameState
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
  gameId: string
}) {
  const battle = state.activeBattle
  const participants = battle ? participantsOf(state, battle) : []
  const [results, setResults] = useState<Record<string, number>>(() =>
    Object.fromEntries(participants.map((p): [string, number] => [p.entry.instanceId, 100])),
  )
  const [repairs, setRepairs] = useState<string[]>([])
  const [deltaInput, setDeltaInput] = useState(0)
  const [prefillNote, setPrefillNote] = useState<string | null>(null)
  // Only asked for while there is a battle and no report yet — once a report is
  // pending there is nothing left to prefill. Hooks run before the early return
  // below, so this is called unconditionally and gated by `enabled`.
  const { data: ftdResult } = useFtdResultQuery(
    gameId, state.activeBattle !== null && state.pendingReport === null,
  )

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

  /**
   * Fill the form in from what the mod reported.
   *
   * Explicit rather than automatic: the numbers are a starting point a captain
   * checks, not an answer. FtD's cleanup rules despawn a badly damaged hull
   * before its alive fraction reaches zero, so a ship that limped out of the
   * fight can arrive here as a 0 — see `hpFromVehicle` in
   * `shared/battleReport.ts`. Auto-applying would also stamp over numbers a
   * player was midway through typing.
   */
  function onApplyFtdResult(prefill: FtdPrefill) {
    const app = applyPrefill(results, prefill, participants.map((p) => p.entry.instanceId))
    setResults(app.results)
    // Same rule onHpChange enforces: a repair pick only stands while its hull
    // is still in the band and not Fragile. New HP numbers can move a hull out
    // of both, and a stale pick would be stripped by SUBMIT_BATTLE_REPORT's
    // validation instead of here, as a 400.
    setRepairs((rs) => rs.filter((id) => {
      const hp = app.results[id]
      if (hp === undefined) return false
      const p = participants.find((x) => x.entry.instanceId === id)
      if (!p || p.entry.keywords.includes(KEYWORDS.FRAGILE)) return false
      return hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT
    }))
    setPrefillNote(prefillSummary(app, (id) =>
      participants.find((x) => x.entry.instanceId === id)?.entry.name ?? id))
  }

  async function onSubmitReport() {
    const validRepairs = repairs.filter((id) => {
      const p = participants.find((x) => x.entry.instanceId === id)
      if (!p || p.side !== mySide || p.isSummon) return false
      const hp = results[id] ?? 0
      return hp >= REPAIR_WINDOW_MIN_PERCENT && hp < SURVIVE_HP_PERCENT && !p.entry.keywords.includes(KEYWORDS.FRAGILE)
    })
    await send({ type: 'SUBMIT_BATTLE_REPORT', results, repairs: validRepairs })
  }

  async function onDecide(approve: boolean, decidedRepairs: string[]) {
    await send({ type: 'DECIDE_BATTLE_REPORT', approve, repairs: decidedRepairs })
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
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl">
            Fleet battle — Zone {battle.zoneId}
            {zone && <span className="text-base capitalize text-ocean-300"> ({zone.biome})</span>}
          </h2>
          <LaunchInFtdButton state={state} gameId={gameId} />
        </div>
        <p className="mt-1 text-sm text-ocean-300">
          Spawn distance: <span className="font-bold text-parchment-100">{battle.distanceM} m</span>
        </p>
        {/*
          The altitude is DERIVED from AIRCRAFT_SPAWN_ALTITUDE_M, never restated:
          this sentence hard-coded "80 m" and kept saying it after the constant
          was retuned to 160, so the panel contradicted the battle file it
          describes. Keep it derived.
        */}
        <p className="mt-2 text-sm text-ocean-300">
          Altitude guidance: surface ships and submarines spawn at the surface; aircraft spawn at{' '}
          {AIRCRAFT_SPAWN_ALTITUDE_M} m; land vehicles spawn on land.
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
            <WaitingNotice participants={participants} report={report} mySide={mySide} />
          ) : (
            <DecisionPanel participants={participants} report={report} state={state} mySide={mySide} busy={busy} onDecide={onDecide} />
          )
        ) : (
          <>
            {ftdResult && (
              <FtdResultBanner
                prefill={ftdResult}
                note={prefillNote}
                factionOf={(side) => state.factions[side as Side]}
                onApply={() => onApplyFtdResult(ftdResult)}
              />
            )}
            <ReportForm
              participants={participants}
              results={results}
              repairs={repairs}
              state={state}
              mySide={mySide}
              busy={busy}
              onHpChange={onHpChange}
              onToggleRepair={onToggleRepair}
              onSubmit={onSubmitReport}
            />
          </>
        )}
      </div>
    </div>
  )
}
