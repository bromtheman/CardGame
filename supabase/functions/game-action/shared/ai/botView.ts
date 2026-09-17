import type { EngineGame, Side } from '../engine/engineTypes.ts'
import type { CardInstance, PublicGameState } from '../engine/gameInit.ts'

// Everything the policy is allowed to see (2026-09-16 AI opponent spec §5.3):
// the public state both players can read, the frozen settings, the turn, its
// own side, its OWN hand, and an rng for tie-breaks. No EngineGame, no
// privates — the opponent's hand and both decks are unreachable from here by
// construction, and botView.test.ts serialises a view to prove it. Public
// counts (state.counts) and a pending choice's options are the only opponent
// information the bot ever reads, exactly as for a human.
export interface BotView {
  state: PublicGameState
  settings: EngineGame['settings']
  turnNumber: number
  side: Side
  hand: CardInstance[]
  rng: () => number
}

export function viewFor(game: EngineGame, side: Side, rng: () => number): BotView {
  return {
    state: game.state,
    settings: game.settings,
    turnNumber: game.turnNumber,
    side,
    hand: game.privates[side].hand,
    rng,
  }
}
