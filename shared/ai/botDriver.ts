import type { EngineContext, EngineGame, GameAction, Side } from '../engine/engineTypes.ts'
import { applyAction, otherSide, sideOf } from '../engine/index.ts'
import type { BotPolicy, OwedKind } from './basicPolicy.ts'
import { viewFor } from './botView.ts'

// Accepted policy actions per request before the driver stops listening to
// the policy and applies fallbacks only (2026-09-16 AI opponent spec §5.2).
export const BOT_ACTION_CAP = 60
// Fallbacks applied after that before the driver gives up and throws.
export const BOT_FALLBACK_CAP = 10

// What the bot owes right now, in the order applyAction freezes things:
// a pending choice first, then the battle windows, then the turn (spec §5.1).
// Null means the human owes the next action — or nobody does, because the
// game is over or a locked battle is waiting to be fought in From The Depths.
// The bot never submits a report, so a report it submitted is unreachable.
export function botOwes(game: EngineGame, botSide: Side): OwedKind | null {
  if (game.status !== 'active') return null
  const s = game.state
  if (s.pendingEffect) return s.pendingEffect.side === botSide ? 'choice' : null
  if (s.awaitingResponse) return otherSide(s.awaitingResponse.aggressor) === botSide ? 'response' : null
  if (s.pendingReport) return s.pendingReport.submittedBy !== botSide ? 'decision' : null
  if (s.activeBattle) return null
  const botId = botSide === 'a' ? game.playerA : game.playerB
  return game.activePlayer === botId ? 'turn' : null
}

// One action per owed kind that the engine's own rules always accept from a
// state that produces that kind. botDriver.test.ts pins each one.
//
// The decision fallback is a REJECT, not a bare approval: approval re-checks
// both sides' repair bills, and a report whose own repairs the submitter
// cannot afford is one the engine lets nobody approve — a bare approval
// would be refused too, and the human's own input would come back as a 500.
// Reject is the one decision the non-submitter can always make. The policy's
// candidates (approve with repairs, then bare approve) still land whenever
// the engine allows, so spec §11 ruling 2 holds: the fallback fires only for
// a report no one could approve, and the human resubmits (spec §5.2).
export const FALLBACK: Record<OwedKind, GameAction> = {
  turn: { type: 'END_TURN' },
  response: { type: 'RESPOND_TO_ATTACK', optOutIds: [] },
  decision: { type: 'DECIDE_BATTLE_REPORT', approve: false },
  choice: { type: 'RESOLVE_PENDING_EFFECT', cancel: true },
}

// Act as the bot until it owes nothing. Pure: applyAction clones, so the
// input is never touched and a refused candidate costs one clone. The policy
// only ever suggests; the engine is the sole legality authority. A fallback
// that is itself refused, or a bot that still owes after the caps, means an
// engine bug — it throws, and game-action answers 500 with nothing committed.
export function runBotUntilIdle(
  input: EngineGame, botId: string, ctx: EngineContext, policy: BotPolicy,
): { game: EngineGame; applied: GameAction[] } {
  const side = sideOf(input, botId)
  if (!side) throw new Error(`PracticeAI (${botId}) is not in this game`)
  let game = input
  const applied: GameAction[] = []
  let fallbacks = 0
  for (;;) {
    const kind = botOwes(game, side)
    if (!kind) return { game, applied }
    let accepted: GameAction | null = null
    if (applied.length < BOT_ACTION_CAP) {
      for (const action of policy.candidates(viewFor(game, side, ctx.rng), kind)) {
        const r = applyAction(game, botId, action, ctx)
        if (r.ok) {
          game = r.game
          accepted = action
          break
        }
      }
    }
    if (!accepted) {
      if (fallbacks++ >= BOT_FALLBACK_CAP) {
        throw new Error(`PracticeAI still owes a ${kind} after ${applied.length} actions`)
      }
      const fallback = FALLBACK[kind]
      const r = applyAction(game, botId, fallback, ctx)
      if (!r.ok) throw new Error(`PracticeAI fallback ${fallback.type} was refused: ${r.error}`)
      game = r.game
      accepted = fallback
    }
    applied.push(accepted)
  }
}
