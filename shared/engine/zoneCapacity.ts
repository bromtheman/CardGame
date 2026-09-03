import { MAX_VEHICLES_PER_ZONE_SIDE } from '../gameSettings.ts'
import type { PublicGameState } from './gameInit.ts'
import type { Side } from './engineTypes.ts'

// How many hulls ONE side may hold on its own half of ONE zone, right now.
//
// The cap used to be the flat MAX_VEHICLES_PER_ZONE_SIDE, read at eight sites.
// SS Tiger Shark makes it a function of the board (2026-09-02 spec §4.1, ruling
// R-1): "While this vehicle is alive, your opponent has 3 fewer vehicle slots
// in this zone. This does not stack."
//
// DERIVED, never stored. Nothing is written when a Tiger Shark lands and
// nothing is unwound when it dies — the cap is simply recomputed, so a denier
// that is destroyed, moved, captured or bounced gives the slots back for free
// and no state can drift out of step with the board.
//
// `slotDenial` is plain card DATA, not an effect name — the reasoning
// `aircraftLock`, `blocksFaction` and `defensiveOmission` already record: the
// card's whole sentence IS this rule, so the next card wanting it needs no
// engine edit. It is in DATA_EFFECT_KEYS for that reason (registry.ts).
//
// A LEAF MODULE by design. It imports gameSettings and two type-only modules
// and nothing else — not even `otherSide` from gameEngine.ts. `costs.ts` records
// why that matters on the engine side (a gameEngine ↔ placement cycle throws at
// import time); on the frontend side it is what keeps laneLayout.ts, which is
// pure geometry, from pulling the whole engine in to learn one number.
export function zoneCapFor(state: PublicGameState, side: Side, zoneId: number): number {
  const zone = state.zones.find((z) => z.id === zoneId)
  // Fail OPEN, deliberately, and NOT in conflict with zoneFull's fail-closed
  // `if (!zone) return true`: that check stays where it is and still refuses
  // the play. This function answers only "what is the cap here?", and with no
  // zone there is no denier to observe.
  if (!zone) return MAX_VEHICLES_PER_ZONE_SIDE
  const enemy: Side = side === 'a' ? 'b' : 'a'
  let denial = 0
  for (const entry of zone.cards[enemy]) {
    const raw = entry.meta.slotDenial
    // Strict, and NaN/Infinity-proof: a mistyped data value must leave the cap
    // alone. `MAX - NaN` is NaN, and every downstream `length >= NaN` reads
    // false — a fat-fingered key would silently switch the cap off for the
    // whole game with the suite green (card-effects.md, blind spot 4).
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) continue
    // MAX, not SUM. That is what "This does not stack" means, and it is what
    // makes a SECOND Tiger Shark inert rather than lethal.
    denial = Math.max(denial, Math.floor(raw))
  }
  // Clamped, so a future card printing a denial ≥ the cap zeroes the side out
  // rather than going negative.
  return Math.max(0, MAX_VEHICLES_PER_ZONE_SIDE - denial)
}
