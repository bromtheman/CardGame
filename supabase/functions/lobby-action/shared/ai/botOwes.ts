import type { EngineGame, Side } from '../engine/engineTypes.ts'
import { otherSide } from '../engine/index.ts'
import type { OwedKind } from './basicPolicy.ts'

// What the bot owes right now, in the order applyAction freezes things:
// a pending choice first, then the battle windows, then the turn (2026-09-16
// AI opponent spec §5.1). Null means the human owes the next action — or
// nobody does, because the game is over or a locked battle is waiting to be
// fought in From The Depths. The bot never submits a report, so a report it
// submitted is unreachable. Its own module (2026-09-19 scored menu spec §3)
// so the evaluator can ask without importing the driver, which imports the
// menu, which imports the evaluator.
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
