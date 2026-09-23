import { FTD_HELD_VEHICLE_TYPES, STUN_DURATION_TURNS } from '../gameSettings.ts'
import type { EngineGame, ZoneCardEntry } from './engineTypes.ts'

// Stun (2026-09-21 LH spec §3.4): until the end of its owner's next turn the
// hull cannot attack (base or fleet), cannot move, and does not Block, Screen
// or withdraw as Stealthy. It still defends. One predicate, six readers —
// baseStrikersIn, activeBlockersIn, fleetAttackRosters (force and the Stealthy
// list), screenBlocks, moveEntry — so the rule cannot drift between them.
export function isStunned(entry: { stunnedUntilTurn?: number }, turnNumber: number): boolean {
  return typeof entry.stunnedUntilTurn === 'number' && turnNumber < entry.stunnedUntilTurn
}

// Whether a generated FtD battle holds this hull still (2026-09-23): stunned
// when the file is built, and of a type that fights safely with its movement
// AI off (FTD_HELD_VEHICLE_TYPES says which, and why). One predicate for the
// battle file's `Stunned` flag and the spawn sheet's marker, which both read it
// through battleTeams, so the two cannot disagree.
export function holdsStillInFtd(
  entry: { stunnedUntilTurn?: number; vehicleType: string | null },
  turnNumber: number,
): boolean {
  return isStunned(entry, turnNumber) &&
    entry.vehicleType !== null && FTD_HELD_VEHICLE_TYPES.includes(entry.vehicleType)
}

// Applied + 1.0 on the turn it lands, so it covers exactly the next turn and
// clears when the one after begins. Every LH stun of an ENEMY lands on LH's own
// turn, so that next turn is the enemy's; Cathode's Overheat (2026-09-23) can
// land on either player's turn, and passes its own log line. Re-stunning
// rewrites the stamp. Rounded the way endTurn rounds turnNumber.
export function stunHull(game: EngineGame, entry: ZoneCardEntry, logLine?: string): void {
  entry.stunnedUntilTurn = Math.round((game.turnNumber + STUN_DURATION_TURNS) * 10) / 10
  game.state.log.push(logLine ?? `${entry.name} is stunned — its systems are down until the end of its owner's next turn`)
}

// Whether a stun wears off when the NEXT turn begins — it lasts to the end of
// this one — rather than a turn later: the stun badge's wording (2026-09-23
// spec §4). Turns advance in half steps.
export function stunEndsThisTurn(entry: { stunnedUntilTurn?: number }, turnNumber: number): boolean {
  return isStunned(entry, turnNumber) && (entry.stunnedUntilTurn as number) - turnNumber <= 0.5
}
