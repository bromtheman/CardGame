import type { GameAction } from '../engine/engineTypes.ts'
import { basicPolicy } from './basicPolicy.ts'
import type { BotPolicy, OwedKind } from './basicPolicy.ts'
import type { BotView } from './botView.ts'
import type { MenuItem } from './llm/moveMenu.ts'

// The evaluator playing alone (2026-09-19 scored menu spec §5): the verified
// menu, best tempo delta first. The third flow (BOT_FLOW=scored), the
// fallback inside both model flows, and what plays with no key. Stateless,
// like basicPolicy; the one-move kinds keep the heuristic's order.
export function rankByScore(menu: MenuItem[]): MenuItem[] {
  const value = (m: MenuItem): number => m.score ?? 0
  return [...menu].sort((x, y) => {
    const d = value(y) - value(x)
    if (d !== 0) return d
    // END TURN loses every tie: materials held at END TURN are lost anyway.
    if (x.action.type === 'END_TURN') return 1
    if (y.action.type === 'END_TURN') return -1
    return x.id - y.id
  })
}

export const scoredPolicy: BotPolicy & { readonly needsMenu: true; candidates(view: BotView, kind: OwedKind): GameAction[] } = {
  needsMenu: true,
  candidates(view, kind) {
    const menu = view.menu ?? []
    // basicPolicy.candidates() is never async, but calling it through its own
    // BotPolicy-and-narrower intersection type resolves here to the general
    // interface signature (GameAction[] | Promise<GameAction[]>) — the same
    // quirk evaluator.ts's settleChoices documents and works around. Narrowed
    // at runtime rather than asserted, so a genuinely async result degrades
    // to an empty tail instead of lying to the type system.
    const rest = basicPolicy.candidates(view, kind)
    const tail = Array.isArray(rest) ? rest : []
    if (kind !== 'turn' || menu.length === 0) return tail
    return [...rankByScore(menu).map((m) => m.action), ...tail]
  },
}
