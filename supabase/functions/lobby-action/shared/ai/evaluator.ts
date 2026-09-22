import { BASE_DAMAGE_DIVISOR, KEYWORDS } from '../gameSettings.ts'
import { materialsPerTurnOf } from '../lobbySettings.ts'
import type { EngineContext, EngineGame, GameAction, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import {
  activeBlockersIn, applyAction, baseStrikersIn, boardChargeOf, effectiveMaterialCostOf, isStunned, otherSide, sideOf,
} from '../engine/index.ts'
import { basicPolicy } from './basicPolicy.ts'
import { botOwes } from './botOwes.ts'
import { viewFor } from './botView.ts'
import { resolveBattle } from './battleSim.ts'
import { mulberry32 } from './seededRng.ts'

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
  charge: 0.15,        // per pip of charge advantage — a fraction of a discharge's tempo (2026-09-21 LH)
} as const

// Base damage a set of hulls deals per bombardment: applies the engine's
// strike-eligibility roster from baseAttack.ts (not subs, not Inoffensive,
// not noBaseDamage; hulls played before the turn count), then excludes
// Temporary hulls (removed at the next turn start, so they never strike) and
// stunned ones (2026-09-21 LH: a stunned hull sits out the turn the score is
// read for).
// Fresh deployments are eligible—the score is read at the start of the
// enemy's turn, and they strike on the bot's.
export function strikePower(hulls: readonly ZoneCardEntry[], turnNumber: number): number {
  const strikers = baseStrikersIn(hulls as ZoneCardEntry[], Infinity)
  return strikers.reduce((sum, c) => {
    if (c.keywords.includes(KEYWORDS.TEMPORARY)) return sum
    // A stunned hull sits out the turn the score is read for (2026-09-21 LH).
    if (isStunned(c, turnNumber)) return sum
    return sum + Math.floor(effectiveMaterialCostOf(c) / BASE_DAMAGE_DIVISOR)
  }, 0)
}

// Turns until `attacker` fells the defender's SECOND base at current power,
// every zone bombarding in parallel: a fallen base is 0, a zone with a
// defending Blocker or no striker stalls at the cap, else HP / power — power
// already excludes Temporary and stunned hulls, via strikePower above
// (2026-09-21 LH). The game ends when the second base falls, but the SUM of
// the two smallest zone times — not just the second-smallest — is what's
// returned, so progress against the first zone stays visible in the score
// rather than vanishing the moment a second zone isn't yet threatened
// (2026-09-19 scored-menu Task 3 fix round 1).
//
// The else branch is clamped at the cap too: HP / power is unbounded when a
// striker is small against a big base (a 1-damage striker on a 1000 HP base
// reads as 1000 turns), and a bombardment that would outlast the cap must
// count like a stalled zone, not worse than one — a stall and a hopeless
// bombardment are the same "not happening", so the cap is the ceiling for
// every zone, the sum stays bounded by twice it, and nothing below the cap
// is ever outranked by a Blocker or an empty zone (spec §3.2).
export function turnsToWin(game: EngineGame, attacker: Side): number {
  const defender = otherSide(attacker)
  const times = game.state.zones.map((z) => {
    const hp = z.baseHp[defender]
    if (hp <= 0) return 0
    if (activeBlockersIn(z.cards[defender] as ZoneCardEntry[], game.turnNumber).length > 0) return EVALUATOR.capTurns
    const power = strikePower(z.cards[attacker] as ZoneCardEntry[], game.turnNumber)
    return power > 0 ? Math.min(EVALUATOR.capTurns, hp / power) : EVALUATOR.capTurns
  }).sort((x, y) => x - y)
  return times.length > 1 ? times[0] + times[1] : (times[0] ?? EVALUATOR.capTurns)
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
    + EVALUATOR.charge * (boardChargeOf(game.state, side) - boardChargeOf(game.state, enemy))
}

const withRng = (ctx: EngineContext, seed: number): EngineContext => ({ ...ctx, rng: mulberry32(seed >>> 0) })
const playerOf = (game: EngineGame, side: Side): string => (side === 'a' ? game.playerA : game.playerB)

// Resolves whatever choice a trial left pending, for either side. The pending
// choice belongs to p.side, and basicPolicy's 'choice' candidates only read
// state.pendingEffect.options and the view's rng — never which side is
// asking — so the same call resolves it whichever side owes it; there is no
// need to gate it on the choice being the BOT's own (an earlier draft did,
// via a condition that reduced to botOwes(game, p.side) === 'choice', which
// is always true here since p.side IS state.pendingEffect.side). Falls back
// to the first option, or cancel, only if basicPolicy offers nothing.
function settleChoices(input: EngineGame, ctx: EngineContext): EngineGame | null {
  let game = input
  for (let guard = 0; guard < EVALUATOR.choiceDepth && game.state.pendingEffect; guard++) {
    const p = game.state.pendingEffect
    const actor = playerOf(game, p.side)
    // basicPolicy's own candidates() is never async — but it is typed through
    // the general BotPolicy interface, whose signature allows a model-backed
    // policy's Promise. Narrowed at runtime rather than asserted, so a
    // genuinely async result degrades to the fallback below instead of lying
    // to the type system.
    const result = basicPolicy.candidates(viewFor(game, p.side, ctx.rng), 'choice')
    const options: GameAction[] = Array.isArray(result) ? result : []
    if (options.length === 0) options.push(p.options.length ? { type: 'RESOLVE_PENDING_EFFECT', choiceId: p.options[0].id } : { type: 'RESOLVE_PENDING_EFFECT', cancel: true })
    let settled = false
    for (const action of options) {
      const r = applyAction(game, actor, action, ctx)
      if (r.ok) { game = r.game; settled = true; break }
    }
    if (!settled) return null
  }
  return game.state.pendingEffect ? null : game
}

// The position at the start of the enemy's turn if the bot ended now.
function endedScore(input: EngineGame, botId: string, side: Side, ctx: EngineContext): number | null {
  const game = settleChoices(input, ctx)
  if (!game) return null
  const owed = botOwes(game, side)
  if (owed === null) {
    // botOwes is null for two different reasons (see its own doc comment):
    // the game decided, OR a locked battle is waiting on a report
    // (state.activeBattle set, no pendingReport yet). The second case cannot
    // reach here: scoreMove checks awaitingResponse/activeBattle on the
    // settled trial and routes to battleMean BEFORE ever calling endedScore
    // directly, and battleMean's own call always runs right after
    // DECIDE_BATTLE_REPORT has cleared both fields (2026-09-19 scored-menu
    // Task 3 fix round 2). So a decided game is the only reachable null here
    // — anything else would mean silently scoring an unresolved battle,
    // which scoreMove's own contract ("null when the trial cannot be
    // completed") rules out.
    return game.status !== 'active' ? positionScore(game, side) : null
  }
  if (owed !== 'turn') return null
  const r = applyAction(game, botId, { type: 'END_TURN' }, ctx)
  return r.ok ? positionScore(r.game, side) : null
}

// Any battle a trial left open — a fleet attack the bot declared, or one an
// effect forced (WF's Martyr Attack, DWG Waters intercepting a bombardment;
// scoreMove routes every awaitingResponse / activeBattle here, whatever the
// action type) — played out EVALUATOR.battleSamples times: the defender
// withdraws nothing (only when it actually has that option — see below) and
// reports a resolver draw, the bot approves repairing nothing, choices
// settle, the turn ends, the position is scored. The mean of the samples
// that completed; null if none did.
//
// `declared` may already hold activeBattle rather than awaitingResponse:
// battleDeclare.ts's ATTACK_ENEMY_FLEET handler opens a response window only
// when the defender has a Stealthy or omissible hull to withdraw — plain
// hulls lock straight into activeBattle, and RESPOND_TO_ATTACK refuses
// outright ("No attack awaits a response") when there is no window to answer.
// So RESPOND_TO_ATTACK is only spent when awaitingResponse says there is one.
function battleMean(declared: EngineGame, botId: string, side: Side, ctx: EngineContext, seed: number): number | null {
  const enemyId = playerOf(declared, otherSide(side))
  const scores: number[] = []
  for (let k = 0; k < EVALUATOR.battleSamples; k++) {
    // 7919 is prime and far bigger than battleSamples, so consecutive samples'
    // seeds land nowhere near each other in mulberry32's state space.
    const sample = withRng(ctx, seed + 7919 * (k + 1))
    let locked = declared
    if (declared.state.awaitingResponse) {
      const responded = applyAction(declared, enemyId, { type: 'RESPOND_TO_ATTACK', optOutIds: [] }, sample)
      if (!responded.ok) continue
      locked = responded.game
    }
    if (!locked.state.activeBattle) continue
    const reported = applyAction(locked, enemyId, { type: 'SUBMIT_BATTLE_REPORT', results: resolveBattle(locked, sample.rng), repairs: [] }, sample)
    if (!reported.ok) continue
    const decided = applyAction(reported.game, botId, { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] }, sample)
    if (!decided.ok) continue
    const s = endedScore(decided.game, botId, side, sample)
    if (s !== null) scores.push(s)
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}

// The score of the position the bot would hand the enemy by making `action`
// and then ending its turn (spec §3.4); END TURN scores its own trial state;
// null when the engine refuses the move or the trial cannot be completed.
export function scoreMove(game: EngineGame, botId: string, action: GameAction, ctx: EngineContext, seed: number): number | null {
  const side = sideOf(game, botId)
  if (!side) return null
  const trial = applyAction(game, botId, action, withRng(ctx, seed))
  if (!trial.ok) return null
  if (action.type === 'END_TURN') return positionScore(trial.game, side)
  // Settle any choice the trial itself raised before asking whether a battle
  // is now open: DP2 fires AT battle lock, so a card that suspends there
  // (Terawatt's join, DWG Waters' clause-2 summon) can freeze a choice
  // alongside the very battle it's asking about — gameEngine.ts's applyAction
  // allows pendingEffect and a battle freeze to both be set at once. +1 so
  // this post-trial rng stream never repeats the trial's own draws when a
  // caller reuses the same seed for both.
  const settled = settleChoices(trial.game, withRng(ctx, seed + 1))
  if (!settled) return null
  // A battle to fight — not only a fleet attack's own response window or
  // lock, but ANY action whose effect force-declares one (WF's Martyr
  // Attack, DWG Waters intercepting a bombardment, declareForcedBattle
  // generally). No longer gated on action.type === 'ATTACK_ENEMY_FLEET'
  // (2026-09-19 scored-menu Task 3 fix round 2): botOwes(game, side) === null
  // ALSO means "a locked battle awaits a report," so the check has to happen
  // here — before endedScore ever reads botOwes; see its own comment. END
  // TURN is exempted above rather than checked here: turnEndRiders (the only
  // thing endTurn dispatches) never calls declareForcedBattle, so ending a
  // turn cannot itself leave a battle open — the spec's "END TURN scores its
  // own trial state" carve-out is unconditional by construction, not by
  // omission. battleMean keeps scoring off the ORIGINAL seed (not seed + 1):
  // its own per-sample offsets are independent of how `settled` was reached,
  // and this preserves the exact numbers already verified for a fleet attack
  // that raises no choice (the common case, where settleChoices is a no-op).
  if (settled.state.awaitingResponse || settled.state.activeBattle) {
    return battleMean(settled, botId, side, ctx, seed)
  }
  return endedScore(settled, botId, side, withRng(ctx, seed + 1))
}
