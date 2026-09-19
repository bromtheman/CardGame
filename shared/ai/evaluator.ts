import { BASE_DAMAGE_DIVISOR, KEYWORDS } from '../gameSettings.ts'
import { materialsPerTurnOf } from '../lobbySettings.ts'
import type { EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import { baseStrikersIn, effectiveMaterialCostOf, otherSide } from '../engine/index.ts'

// A one-ply position evaluator in TURNS OF TEMPO (2026-09-19 scored menu
// spec §3). Under this engine a game is a two-base bombardment race: the
// score is how many turns the enemy needs to fell the bot's second base
// minus how many the bot needs for theirs, plus small board, hand and
// base-HP terms. Weights are the ones the 92 % self-play experiment used.
export const EVALUATOR = {
  capTurns: 60,        // a zone nobody can fell "takes" this long
  battleSamples: 6,    // resolver draws averaged for a fleet attack (§3.4)
  choiceDepth: 4,      // pending choices resolved per trial before giving up
  board: 0.4,          // per turn of income of board-cost advantage
  hand: 0.1,           // per card in the bot's hand
  baseHp: 0.0005,      // per HP of base advantage (1000 HP = half a turn)
  win: 1000,           // a decided game
} as const

// Base damage a set of hulls deals per bombardment: applies the engine's
// strike-eligibility roster from baseAttack.ts (not subs, not Inoffensive,
// not noBaseDamage; hulls played before the turn count), then excludes
// Temporary hulls (removed at the next turn start, so they never strike).
// Fresh deployments are eligible—the score is read at the start of the
// enemy's turn, and they strike on the bot's.
export function strikePower(hulls: readonly ZoneCardEntry[]): number {
  const strikers = baseStrikersIn(hulls as ZoneCardEntry[], Infinity)
  return strikers.reduce((sum, c) => {
    if (c.keywords.includes(KEYWORDS.TEMPORARY)) return sum
    return sum + Math.floor(effectiveMaterialCostOf(c) / BASE_DAMAGE_DIVISOR)
  }, 0)
}

// Turns until `attacker` fells the defender's SECOND base at current power,
// every zone bombarding in parallel: a fallen base is 0, a zone with a
// defending Blocker or no striker stalls at the cap, else HP / power.
export function turnsToWin(game: EngineGame, attacker: Side): number {
  const defender = otherSide(attacker)
  const times = game.state.zones.map((z) => {
    const hp = z.baseHp[defender]
    if (hp <= 0) return 0
    if (z.cards[defender].some((c) => c.keywords.includes(KEYWORDS.BLOCKER))) return EVALUATOR.capTurns
    const power = strikePower(z.cards[attacker] as ZoneCardEntry[])
    return power > 0 ? Math.min(EVALUATOR.capTurns, hp / power) : EVALUATOR.capTurns
  }).sort((x, y) => x - y)
  return times.length > 1 ? times[1] : (times[0] ?? EVALUATOR.capTurns)
}

const boardCost = (game: EngineGame, side: Side): number =>
  game.state.zones.reduce((s, z) => s + z.cards[side].reduce((t, c) => t + effectiveMaterialCostOf(c), 0), 0)

export function positionScore(game: EngineGame, side: Side): number {
  const enemy = otherSide(side)
  const me = side === 'a' ? game.playerA : game.playerB
  if (game.status !== 'active') return game.winnerId === me ? EVALUATOR.win : -EVALUATOR.win
  const income = materialsPerTurnOf(game.settings) * Math.max(1, Math.floor(game.turnNumber))
  return turnsToWin(game, enemy) - turnsToWin(game, side)
    + EVALUATOR.board * (boardCost(game, side) - boardCost(game, enemy)) / income
    + EVALUATOR.hand * game.privates[side].hand.length
    + EVALUATOR.baseHp * game.state.zones.reduce((t, z) => t + z.baseHp[side] - z.baseHp[enemy], 0)
}
