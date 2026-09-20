import type { GameAction } from '../engine/engineTypes.ts'
import { basicPolicy } from './basicPolicy.ts'
import type { BotPolicy, OwedKind } from './basicPolicy.ts'
import type { BotView } from './botView.ts'
import type { MenuItem } from './llm/moveMenu.ts'

// The evaluator playing alone (2026-09-19 scored menu spec §5): the verified
// menu, best tempo delta first. The third flow (BOT_FLOW=scored), the
// fallback inside both model flows, and what plays with no key. Stateless,
// like basicPolicy; the one-move kinds keep the heuristic's order.
//
// Only a STRICTLY POSITIVE delta ranks above END TURN. A zero or null delta
// is "no better than ending", and END TURN goes ahead of every such item —
// an earlier "END TURN loses every tie" rule looped: SET_ALERT_CARD is legal
// as long as an ability card is in hand (a re-reveal replaces the last one)
// and worth exactly nothing (the alert expires with the turn), so the driver
// revealed it until BOT_ACTION_CAP, sixty menus and as many public log lines
// per request. Above END TURN: score descending, menu order on ties. At or
// below it: menu order, still offered in case END TURN is refused.
export function rankByScore(menu: MenuItem[]): MenuItem[] {
  const value = (m: MenuItem): number => m.score ?? 0
  const isEnd = (m: MenuItem): boolean => m.action.type === 'END_TURN'
  const above = menu.filter((m) => !isEnd(m) && value(m) > 0).sort((x, y) => (value(y) - value(x)) || (x.id - y.id))
  const end = menu.filter(isEnd)
  const rest = menu.filter((m) => !isEnd(m) && !(value(m) > 0))
  return [...above, ...end, ...rest]
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
