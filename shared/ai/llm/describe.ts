import type { EngineGame, GameAction, Side } from '../../engine/engineTypes.ts'

// Placeholder until Task 3: the action's type is enough for the menu tests.
export function describeMenuItem(_before: EngineGame, _after: EngineGame, _side: Side, action: GameAction): string {
  return action.type
}
