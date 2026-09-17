import type { GameAction } from '../engine/engineTypes.ts'
import type { OwedKind } from './basicPolicy.ts'

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
