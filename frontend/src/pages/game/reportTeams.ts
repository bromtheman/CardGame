import type { Side } from '@shared/engine/engineTypes'

export interface SplitRoster<T> { mine: T[]; theirs: T[] }

/**
 * Split a battle roster into the viewing captain's ships and the opponent's, so
 * the battle-report panels can head one column "Your ships" and the other
 * "Their ships". Two captains routinely field the *same* hull, and a single
 * merged list of names gives the reader no way to tell which "Abactor" just
 * died.
 *
 * Roster order is preserved inside each group, and every entry lands in exactly
 * one of them — a vehicle dropped by the split would still be submitted (the
 * form seeds every participant at 100%), just with an HP nobody could edit.
 * BattleOverlay has been bitten before by a roster the UI and the engine
 * disagreed about; see the comment above its `participantsOf`.
 */
export function splitRosterBySide<T extends { side: Side }>(roster: T[], mySide: Side): SplitRoster<T> {
  return {
    mine: roster.filter((p) => p.side === mySide),
    theirs: roster.filter((p) => p.side !== mySide),
  }
}
