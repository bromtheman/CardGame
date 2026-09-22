import { CHARGE_TICK, FACTIONS } from '../gameSettings.ts'
import type { PublicGameState } from './gameInit.ts'
import type { ChargeShare, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'

// Per-hull Charge (2026-09-21 LH spec §3.1). A card prints meta.chargeMax;
// its hull carries `charge`, absent meaning 0. Every write goes through
// addCharge/spendCharge so the cap and the "absent is zero" rule live here.

const positiveInt = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null

type HasMeta = { meta: Record<string, unknown> }

export function chargeMaxOf(card: HasMeta): number { return positiveInt(card.meta.chargeMax) ?? 0 }
export function chargeRateOf(card: HasMeta): number { return positiveInt(card.meta.chargeRate) ?? CHARGE_TICK }
export function chargeRelayOf(card: HasMeta): number { return positiveInt(card.meta.chargeRelay) ?? 0 }
export function chargeGateOf(card: HasMeta): number { return positiveInt(card.meta.requiresCharge) ?? 0 }
// "Discharge N from a friendly LH vehicle" on an ability card (§3.2); null when absent.
export function dischargeFromOf(card: HasMeta): number | null { return positiveInt(card.meta.dischargeFrom) }

export function chargeOf(entry: { charge?: number }): number {
  return typeof entry.charge === 'number' && Number.isFinite(entry.charge) ? entry.charge : 0
}

export function hasChargeRoom(entry: ZoneCardEntry): boolean {
  return chargeOf(entry) < chargeMaxOf(entry)
}

// Returns what was actually added, after the cap (§3.1.4).
export function addCharge(entry: ZoneCardEntry, amount: number): number {
  const max = chargeMaxOf(entry)
  if (max === 0 || amount <= 0) return 0
  const before = chargeOf(entry)
  const after = Math.min(max, before + amount)
  entry.charge = after
  return after - before
}

export function spendCharge(entry: ZoneCardEntry, amount: number): boolean {
  if (amount <= 0) return true
  if (chargeOf(entry) < amount) return false
  entry.charge = chargeOf(entry) - amount
  return true
}

// The Drain gate reads the whole board (§3.3; printed "Requires N Charge" until
// 2026-09-22). "LH" is faction === 'LH': player-made cards are NEUTRAL and never count.
export function boardChargeOf(state: PublicGameState, side: Side): number {
  let total = 0
  for (const zone of state.zones) {
    for (const c of zone.cards[side]) if (c.faction === FACTIONS.LH) total += chargeOf(c as ZoneCardEntry)
  }
  return total
}

export function chargeGateShortfall(
  state: PublicGameState, side: Side, card: HasMeta,
): { required: number; have: number } | null {
  const required = chargeGateOf(card)
  if (required === 0) return null
  const have = boardChargeOf(state, side)
  return have >= required ? null : { required, have }
}

// The turn-start tick for `side` (§3.1.2, §3.1.5): every hull gains its rate,
// then every lane holding a relay hands its non-relay hulls the relay bonus —
// `max` over relays, never `sum`, so a second Conduit is inert (R-4).
export function tickCharge(game: EngineGame, side: Side): void {
  for (const zone of game.state.zones) {
    const mine = zone.cards[side] as ZoneCardEntry[]
    for (const entry of mine) addCharge(entry, chargeRateOf(entry))
    const relay = mine.reduce((best, c) => Math.max(best, chargeRelayOf(c)), 0)
    if (relay === 0) continue
    for (const entry of mine) if (chargeRelayOf(entry) === 0) addCharge(entry, relay)
  }
}

// ── 2026-09-22 Drain N Charge (docs/superpowers/specs/2026-09-22-lh-drain-charge-design.md) ──
// A gated card (meta.requiresCharge, printed "Drain N Charge") is paid for in
// pips from any mix of the player's LH hulls. These are the ONE copy of the
// payment rules: both deploy handlers, the split dialog and PracticeAI (which
// always pays the suggested split) import them — nothing re-derives them.

export interface ChargePayer { zoneId: number; entry: ZoneCardEntry }

// The player's LH hulls holding charge, in board order: zones in state.zones
// order, then hulls in zone.cards[side] order — §2.1's tie-break.
export function chargePayersOf(state: PublicGameState, side: Side): ChargePayer[] {
  const out: ChargePayer[] = []
  for (const zone of state.zones) {
    for (const c of zone.cards[side] as ZoneCardEntry[]) {
      if (c.faction === FACTIONS.LH && chargeOf(c) > 0) out.push({ zoneId: zone.id, entry: c })
    }
  }
  return out
}

const ownsDischarge = (entry: ZoneCardEntry): boolean => positiveInt(entry.meta.dischargeCost) !== null

// §2.1, one pip at a time: hulls with no Discharge of their own first, the
// fullest first (a full battery wastes its next tick, so levelling several
// down lets the next tick refill them all); then Discharge hulls, the
// emptiest first (a nearly ready timer stays ready, and one already short is
// drained further before another is touched). Ties in board order. Null when
// the board holds less than `amount`.
export function suggestedChargeSplit(state: PublicGameState, side: Side, amount: number): ChargeShare[] | null {
  const payers = chargePayersOf(state, side)
  const left = payers.map((p) => chargeOf(p.entry))
  if (left.reduce((sum, n) => sum + n, 0) < amount) return null
  const taken = payers.map(() => 0)
  for (let owed = amount; owed > 0; owed--) {
    let pick = -1
    for (let i = 0; i < payers.length; i++) {
      if (left[i] === 0) continue
      if (pick === -1) { pick = i; continue }
      const iTimer = ownsDischarge(payers[i].entry)
      const pickTimer = ownsDischarge(payers[pick].entry)
      if (iTimer !== pickTimer) { if (!iTimer) pick = i; continue }
      if (iTimer ? left[i] < left[pick] : left[i] > left[pick]) pick = i
    }
    left[pick]--
    taken[pick]++
  }
  return payers.flatMap((p, i) => (taken[i] > 0 ? [{ instanceId: p.entry.instanceId, amount: taken[i] }] : []))
}

// Why `split` cannot pay a Drain of `amount` for `side`, or null when it can
// (§3). Typed over unknown[] because it validates a network payload.
export function chargeSplitError(
  state: PublicGameState, side: Side, amount: number, split: readonly unknown[],
): string | null {
  const mine = new Map<string, ZoneCardEntry>()
  for (const zone of state.zones) {
    for (const c of zone.cards[side] as ZoneCardEntry[]) if (c.faction === FACTIONS.LH) mine.set(c.instanceId, c)
  }
  const seen = new Set<string>()
  let total = 0
  for (const raw of split) {
    const share = (raw ?? {}) as Partial<ChargeShare>
    const hull = typeof share.instanceId === 'string' ? mine.get(share.instanceId) : undefined
    if (!hull) return 'That charge source is not one of your LH vehicles on the board'
    if (seen.has(hull.instanceId)) return `${hull.name} is listed twice`
    seen.add(hull.instanceId)
    const n = share.amount
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      return `${hull.name} must give up a whole number of charge, at least 1`
    }
    if (n > chargeOf(hull)) return `${hull.name} holds only ${chargeOf(hull)} charge`
    total += n
  }
  return total === amount ? null : `Choose exactly ${amount} charge — you chose ${total}`
}

// §2.2: no real choice — the board holds exactly `amount`, or one hull holds
// all of the player's charge.
export function chargeSplitIsForced(state: PublicGameState, side: Side, amount: number): boolean {
  const payers = chargePayersOf(state, side)
  return payers.length === 1 || payers.reduce((sum, p) => sum + chargeOf(p.entry), 0) === amount
}

// The split dialog's gate (§4): a gated card the board can pay, more than one way.
export function drainNeedsChoice(state: PublicGameState, side: Side, card: HasMeta): boolean {
  const gate = chargeGateOf(card)
  return gate > 0 && boardChargeOf(state, side) >= gate && !chargeSplitIsForced(state, side, gate)
}

export type DrainPlan = { split: ChargeShare[] } | { error: string }

// Everything a play checks about its Drain, before anything moves (§2, §3):
// the whole-board precondition, then the player's split — or the suggested
// one when the play names none (PracticeAI, a stale client, a forced split).
export function planDrain(
  state: PublicGameState, side: Side, card: HasMeta & { name: string }, chargeFrom: unknown,
): DrainPlan {
  const gate = chargeGateOf(card)
  if (gate === 0) {
    const sent = Array.isArray(chargeFrom) ? chargeFrom.length > 0 : chargeFrom !== undefined
    return sent ? { error: `${card.name} drains no charge` } : { split: [] }
  }
  const shortfall = chargeGateShortfall(state, side, card)
  if (shortfall) return { error: `${card.name} drains ${shortfall.required} charge — your LH vehicles hold ${shortfall.have}` }
  if (chargeFrom === undefined) return { split: suggestedChargeSplit(state, side, gate)! }
  if (!Array.isArray(chargeFrom)) return { error: 'chargeFrom must be a list of { instanceId, amount }' }
  const error = chargeSplitError(state, side, gate, chargeFrom)
  return error ? { error } : { split: chargeFrom as ChargeShare[] }
}

// Spends a split planDrain returned and logs it — public, since every payer
// is on the board. Paying is not an activation: activatedOnTurn is never
// touched, so a payer may still Discharge this turn with what it has left.
export function applyDrain(game: EngineGame, side: Side, cardName: string, split: readonly ChargeShare[]): void {
  if (split.length === 0) return
  const byId = new Map(split.map((s) => [s.instanceId, s.amount]))
  const parts: string[] = []
  let total = 0
  for (const { entry } of chargePayersOf(game.state, side)) {
    const amount = byId.get(entry.instanceId)
    if (amount === undefined) continue
    spendCharge(entry, amount)
    parts.push(`${entry.name} ${amount}`)
    total += amount
  }
  game.state.log.push(`${cardName} drains ${total} charge — ${parts.join(', ')}`)
}
