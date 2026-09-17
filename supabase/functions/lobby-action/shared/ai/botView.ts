import type { EngineGame, Side } from '../engine/engineTypes.ts'
import type { CardInstance, PublicGameState } from '../engine/gameInit.ts'
import type { MenuItem } from './llm/moveMenu.ts'

// Everything the policy is allowed to see (2026-09-16 AI opponent spec §5.3):
// the public state both players can read, the frozen settings, the turn, its
// own side, its OWN hand, an rng for tie-breaks — and, for a policy that asks
// (needsMenu), the verified move menu, whose texts are public diffs by
// construction (LLM spec §4.3). No EngineGame, no privates — the opponent's
// hand and both decks are unreachable from here, and botView.test.ts
// serialises a view WITH a menu to prove it.
export interface BotView {
  state: PublicGameState
  settings: EngineGame['settings']
  turnNumber: number
  side: Side
  hand: CardInstance[]
  rng: () => number
  menu?: MenuItem[]
}

export function viewFor(game: EngineGame, side: Side, rng: () => number, menu?: MenuItem[]): BotView {
  return {
    state: game.state,
    settings: game.settings,
    turnNumber: game.turnNumber,
    side,
    hand: game.privates[side].hand,
    rng,
    ...(menu ? { menu } : {}),
  }
}
