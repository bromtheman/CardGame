import { CHARGE_TICK, FACTIONS } from '../gameSettings.ts'
import type { PublicGameState } from './gameInit.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'

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

// The Requires gate reads the whole board (§3.3). "LH" is faction === 'LH':
// player-made cards are NEUTRAL and never count.
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
