import { STUN_DURATION_TURNS } from '../gameSettings.ts'
import type { EngineGame, ZoneCardEntry } from './engineTypes.ts'

// Stun (2026-09-21 LH spec §3.4): until the end of its owner's next turn the
// hull cannot attack (base or fleet), cannot move, and does not Block, Screen
// or withdraw as Stealthy. It still defends. One predicate, six readers —
// baseStrikersIn, activeBlockersIn, fleetAttackRosters (force and the Stealthy
// list), screenBlocks, moveEntry — so the rule cannot drift between them.
export function isStunned(entry: { stunnedUntilTurn?: number }, turnNumber: number): boolean {
  return typeof entry.stunnedUntilTurn === 'number' && turnNumber < entry.stunnedUntilTurn
}

// Applied + 1.0: every LH stun lands on LH's own turn, so this is exactly one
// enemy turn, clearing when the stunner's next turn begins. Re-stunning
// rewrites the stamp. Rounded the way endTurn rounds turnNumber.
export function stunHull(game: EngineGame, entry: ZoneCardEntry): void {
  entry.stunnedUntilTurn = Math.round((game.turnNumber + STUN_DURATION_TURNS) * 10) / 10
  game.state.log.push(`${entry.name} is stunned — its systems are down until the end of its owner's next turn`)
}
