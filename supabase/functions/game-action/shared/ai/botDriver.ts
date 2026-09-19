import type { EngineContext, EngineGame, GameAction, Side } from '../engine/engineTypes.ts'
import { applyAction, otherSide, sideOf } from '../engine/index.ts'
import { LOG_MAX_ENTRIES } from '../gameSettings.ts'
import type { BotPolicy, OwedKind, PolicyHooks } from './basicPolicy.ts'
import { viewFor } from './botView.ts'
import { FALLBACK } from './fallbacks.ts'
import { describeOutcome } from './llm/describe.ts'
import { buildMenu } from './llm/moveMenu.ts'
import { formatTableTalk, guardTableTalk } from './llm/tableTalk.ts'
export { FALLBACK } from './fallbacks.ts'

// Accepted policy actions per request before the driver stops listening to
// the policy and applies fallbacks only (2026-09-16 AI opponent spec §5.2).
export const BOT_ACTION_CAP = 60
// Fallbacks applied after that before the driver gives up and throws.
export const BOT_FALLBACK_CAP = 10

// What a caller does with the game at a policy's checkpoint — game-action
// commits it (2026-09-18 sectioned bot turn spec §5.4). Absent, the markers
// still land in the log and the caller commits once at the end.
export type Checkpoint = (game: EngineGame) => Promise<void>

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

// The one place a table-talk line enters the public log: after the engine's
// own lines for the move that carried it, under the prefix, past the guard,
// and under the same cap applyAction's finish() applies (LLM spec §3.2, §6.2).
function appendLog(game: EngineGame, line: string): EngineGame {
  return { ...game, state: { ...game.state, log: [...game.state.log, line].slice(-LOG_MAX_ENTRIES) } }
}

// Act as the bot until it owes nothing. Pure: applyAction clones, so the
// input is never touched and a refused candidate costs one clone. The policy
// only ever suggests; the engine is the sole legality authority. A fallback
// that is itself refused, or a bot that still owes after the caps, means an
// engine bug — it throws, and game-action answers 500 with nothing further
// committed. Async since the LLM spec: a policy may await a model; the menu
// is built only for a policy that declares needsMenu, so the heuristic costs
// what it always did. A sectioned policy checkpoints through the hooks it is
// handed: the marker is a fixed driver line (no guard needed — it names no
// card), and onCheckpoint sees the game with it, before the policy's next
// call (sectioned spec §5.2).
export async function runBotUntilIdle(
  input: EngineGame, botId: string, ctx: EngineContext, policy: BotPolicy, onCheckpoint?: Checkpoint,
): Promise<{ game: EngineGame; applied: GameAction[]; talk: string[] }> {
  const side = sideOf(input, botId)
  if (!side) throw new Error(`PracticeAI (${botId}) is not in this game`)
  let game = input
  const applied: GameAction[] = []
  const talk: string[] = []
  let fallbacks = 0
  const hooks: PolicyHooks = {
    checkpoint: async (marker) => {
      game = appendLog(game, marker)
      if (onCheckpoint) await onCheckpoint(game)
    },
  }
  for (;;) {
    const kind = botOwes(game, side)
    if (!kind) return { game, applied, talk }
    let accepted: GameAction | null = null
    let before = game
    if (applied.length < BOT_ACTION_CAP) {
      const menu = policy.needsMenu ? buildMenu(game, botId, ctx, kind) : undefined
      const candidates = await policy.candidates(viewFor(game, side, ctx.rng, menu), kind, hooks)
      before = game   // after any markers, so the outcome never quotes one
      for (const action of candidates) {
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
    // Told for fallbacks too, so a plan-holding policy learns its plan is
    // stale, and told what the move really did; the line it returns is
    // guarded against the POST-move state, so a card just played may be
    // named and a card still in hand may not.
    const outcome = describeOutcome(before, game, side)
    const line = guardTableTalk(policy.onAccepted?.(accepted, kind, outcome) ?? null, game, side)
    if (line !== null) {
      game = appendLog(game, formatTableTalk(line))
      talk.push(line)
    }
    applied.push(accepted)
  }
}
