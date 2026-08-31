import { KEYWORDS, UPKEEP_RATE } from '../gameSettings.ts'
import type { PublicGameState } from './gameInit.ts'
import type { Side } from './engineTypes.ts'

// Cost formulas needed by more than one engine module, kept in a LEAF module
// so they can be. `effectiveMaterialCostOf` used to live in placement.ts, and
// endTurn (gameEngine.ts) cannot import from there: placement.ts imports
// `registerHandler` from gameEngine.ts and calls it at module top level, so a
// gameEngine → placement edge closes a cycle in which placement's
// registration runs while gameEngine's `handlers` const is still in its
// temporal dead zone — a ReferenceError at import time, not a type error.
//
// placement.ts re-exports `effectiveMaterialCostOf`, so every existing
// importer (battleResolve, baseAttack, the frontend, engine/index) is
// unchanged and there is still exactly one definition.

// Spec §3.7 Half-Cost: the discount is applied at usage time, never baked
// into stored material_cost (seed data and create-card both store full cost).
export function effectiveMaterialCostOf(card: { materialCost: number; keywords: string[] }): number {
  return card.keywords.includes(KEYWORDS.HALF_COST)
    ? Math.floor(card.materialCost / 2)
    : card.materialCost
}

// Wave 7's UPKEEP_REQUIRED (spec §7.3, rulings U-1 … U-4): the total a side
// owes at the start of its own turn, summed over every hull it CONTROLS in
// every zone.
//
// Four rulings live in these four lines:
//
//   U-1  `effectiveMaterialCostOf`, never `effectiveCostInGame`. The latter is
//        play-time-only (costModifier, costDelta, resourceSurge) and must not
//        reach a recurring charge. ⚠ No seeded card carries both
//        UPKEEP_REQUIRED and HALF_COST, so the two candidate authorities agree
//        on every card that exists — only the fixture in gameEngine.test.ts
//        separates them.
//   U-2  `Math.ceil`, matching repairCostOf, the other player-facing charge.
//        Every real card's 15% is exact to the hundred, so this too is pinned
//        by a fixture rather than by data.
//   U-4  whoever CONTROLS the hull pays. `ownerSideOf` decides whose DECK a
//        captured card returns to, never who feeds it. Battle summons never
//        enter zone.cards and so never appear here at all (spec §4.4).
//
// Returns the gross total; the caller owns the clamp (U-3).
export function upkeepOwedBy(state: PublicGameState, side: Side): number {
  let owed = 0
  for (const zone of state.zones) {
    for (const entry of zone.cards[side]) {
      if (!entry.keywords.includes(KEYWORDS.UPKEEP_REQUIRED)) continue
      owed += Math.ceil(effectiveMaterialCostOf(entry) * UPKEEP_RATE)
    }
  }
  return owed
}
