import type { PublicGameState } from '@shared/engine/gameInit'
import type { Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { chargeOf } from '@shared/engine/index'
import { FACTIONS } from '@shared/gameSettings'

// §3.2 / R-20: a discharge-from ability needs a friendly LH hull, in ANY
// zone, that still holds at least `cost` charge AND has not already hosted
// (or been activated) this turn — hosting a discharge IS the hull's
// activation for the turn (placement.ts stamps `activatedOnTurn` on a
// successful host, the same field ACTIVATE_VEHICLE stamps), so a second host
// in one turn is exactly as illegal as a second ACTIVATE_VEHICLE. Mirrors the
// engine's own PLAY_CARD_TARGETING_CARD_ON_FIELD checks — never re-derive
// them differently here.
export function dischargeHostAvailable(
  state: PublicGameState, mySide: Side, cost: number, turnNumber: number,
): boolean {
  return state.zones.some((zone) => (
    (zone.cards[mySide] as ZoneCardEntry[]).some(
      (e) => e.faction === FACTIONS.LH && chargeOf(e) >= cost && e.activatedOnTurn !== turnNumber,
    )
  ))
}
