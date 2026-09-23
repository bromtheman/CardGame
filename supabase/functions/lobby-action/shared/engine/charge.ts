import { CHARGE_TICK, DRAIN_DISCOUNT_PER_CHARGE, FACTIONS } from '../gameSettings.ts'
import { shortHandNumber } from '../format.ts'
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

// A Drain reads the whole board (2026-09-21 spec §3.3; a gate until 2026-09-23,
// a discount since). "LH" is faction === 'LH': player-made cards are NEUTRAL and never count.
export function boardChargeOf(state: PublicGameState, side: Side): number {
  let total = 0
  for (const zone of state.zones) {
    for (const c of zone.cards[side]) if (c.faction === FACTIONS.LH) total += chargeOf(c as ZoneCardEntry)
  }
  return total
}

// "Drain N Charge: costs Xk less" (2026-09-23 spec §2): X = N × DRAIN_DISCOUNT_PER_CHARGE,
// earned only by draining all N. Zero for a card without a Drain.
export function drainDiscountOf(card: HasMeta): number {
  return chargeGateOf(card) * DRAIN_DISCOUNT_PER_CHARGE
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

// ── Drain N Charge (2026-09-22; a discount since docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md) ──
// A Drain card (meta.requiresCharge, printed "Drain N Charge: costs Xk less")
// may be paid for in pips from any mix of the player's LH hulls — all N of
// them for N × 50k off, or none at the printed price. These are the ONE copy of
// the payment rules: both deploy handlers, the dialog and PracticeAI (which
// drains the suggested split whenever it can) import them — nothing re-derives them.

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

export type DrainPlan = { split: ChargeShare[]; discount: number } | { error: string }

// Everything a play decides about its Drain, before anything moves
// (2026-09-23 spec §2–§3). All or nothing: exactly N pips for the discount, or
// none at the printed price — there is no partial drain, and a short board is
// never refused, it just pays full price.
//   - chargeFrom absent (PracticeAI, a forced split): the suggested split when
//     the board holds N, otherwise full price;
//   - chargeFrom []: a deliberate full-price play;
//   - a named split: validated by chargeSplitError, so it totals exactly N.
export function planDrain(
  state: PublicGameState, side: Side, card: HasMeta & { name: string }, chargeFrom: unknown,
): DrainPlan {
  const fullPrice: DrainPlan = { split: [], discount: 0 }
  const gate = chargeGateOf(card)
  if (gate === 0) {
    const sent = Array.isArray(chargeFrom) ? chargeFrom.length > 0 : chargeFrom !== undefined
    return sent ? { error: `${card.name} drains no charge` } : fullPrice
  }
  if (chargeFrom === undefined) {
    const suggested = suggestedChargeSplit(state, side, gate)
    return suggested ? { split: suggested, discount: drainDiscountOf(card) } : fullPrice
  }
  if (!Array.isArray(chargeFrom)) return { error: 'chargeFrom must be a list of { instanceId, amount }' }
  if (chargeFrom.length === 0) return fullPrice
  const error = chargeSplitError(state, side, gate, chargeFrom)
  return error ? { error } : { split: chargeFrom as ChargeShare[], discount: drainDiscountOf(card) }
}

// Spends a split planDrain returned and logs it with its discount — public,
// since every payer is on the board, and "for 100k off" says it is a payment,
// not an ability (the 2026-09-22 playtest misread). Paying is not an
// activation: activatedOnTurn is never touched, so a payer may still
// Discharge this turn with what it has left. A full-price play logs nothing.
export function applyDrain(
  game: EngineGame, side: Side, cardName: string, split: readonly ChargeShare[], discount: number,
): void {
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
  game.state.log.push(`${cardName} drains ${total} charge for ${shortHandNumber(discount)} off — ${parts.join(', ')}`)
}
