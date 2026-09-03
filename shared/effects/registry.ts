import { TRIGGERS } from '../gameSettings.ts'
import type {
  BattleContext, BattleContinuation, EngineContext, EngineGame, Side,
} from '../engine/engineTypes.ts'
import type { CardInstance, PendingEffect, PublicGameState } from '../engine/gameInit.ts'

export interface EffectPayload {
  game: EngineGame
  actor: Side
  card: CardInstance
  ctx: EngineContext
  targetZoneId?: number
  targetInstanceId?: string
  // Ids this play just placed on the board (the card plus any
  // additionalSpawns copies). Predicates that ask "was this zone empty?"
  // must exclude them — PLAY_CARD_TO_ZONE places before effects fire.
  placedInstanceIds?: string[]
  // Set only on the second entry, by RESOLVE_PENDING_EFFECT. An effect that
  // can suspend branches on `resolution === undefined` to tell the phases
  // apart; `pending` is the slot it wrote on the first entry.
  resolution?: { choiceId?: string; targetInstanceId?: string; zoneId?: number }
  pending?: PendingEffect
  // Set ONLY by the battle-resolve dispatch (DECIDE_BATTLE_REPORT), from the
  // ActiveBattle.continuation it is re-entering. A first entry and a
  // post-battle re-entry otherwise carry an identical payload shape — this
  // field is the only thing that lets an effect tell them apart.
  continuation?: BattleContinuation
  // Set ONLY by the DP2 dispatch (shared/engine/battleTriggers.ts). Present on
  // a battle trigger and absent everywhere else, so an effect that serves both
  // a play and a battle — dwgWatersEffect does — branches on it.
  battle?: BattleContext
}
export type EffectFn = (payload: EffectPayload) => boolean
export type CostModifierFn = (state: PublicGameState, side: Side, card: CardInstance) => number

const effects = new Map<string, EffectFn>()
const costModifiers = new Map<string, CostModifierFn>()

// Effects that need the built-in card catalog supplied via EngineContext.
// Derived from registration so it can never drift from the implementations.
const catalogEffects = new Set<string>()
export const CATALOG_EFFECTS: ReadonlySet<string> = catalogEffects

// Effects that react to a battle their card is NOT fighting in (spec §4.3, DP2
// departure 2). Derived from registration for the same reason CATALOG_EFFECTS
// is — and load-bearing beyond bookkeeping: the forced-battle bystander pass
// dispatches ONLY to members, which is what keeps every other battle trigger
// out of it. Without the flag, all six DP2 cards would need an `isParticipant`
// guard they could each silently forget. Terawatt is the only member today.
const bystanderEffects = new Set<string>()
export const BYSTANDER_EFFECTS: ReadonlySet<string> = bystanderEffects

// Effects that want DP7 — the dispatch that fires when the OPPONENT deploys
// into a zone their rider watches (spec §4.3, "DP7 as wave 6 built it").
// Derived from registration, and opt-in for the same load-bearing reason
// BYSTANDER_EFFECTS is: dispatchDeployWatchers fires ONLY to members, so no
// other zone rider ever meets a `phase: 'deploy'` context it was not written
// for. dwgWatersEffect is why that matters — its router falls through to its
// claim branch for any phase it does not recognise. Blockade is the only
// member today.
const deployWatcherEffects = new Set<string>()
export const DEPLOY_WATCHER_EFFECTS: ReadonlySet<string> = deployWatcherEffects

// Effects that want DP8 — the RESOLVE-phase bystander pass (spec §4.3, "DP8 as
// wave 7 built it"). BYSTANDER_EFFECTS above cannot serve them: it fires only
// at LOCK, only on a FORCED battle, only for the DEFENDER, and only in the
// battle's own zone. TG Vengeful needs the resolve phase (a loss is not known
// until then), on every battle, from any zone, on either side.
//
// Derived from registration, and opt-in for the same load-bearing reason the
// two above are: dispatchBattleResolve's second pass fires ONLY to members, so
// no other battle trigger ever meets a context it was not written for.
// dwgWatersEffect is why that matters — its router falls through to its claim
// branch for any context it does not recognise, so a broadcast would make it
// attempt a claim with no target zone on EVERY battle in the game. Vengeful is
// the only member today.
const resolveBystanderEffects = new Set<string>()
export const RESOLVE_BYSTANDER_EFFECTS: ReadonlySet<string> = resolveBystanderEffects

export function registerEffect(
  name: string,
  fn: EffectFn,
  opts?: {
    needsCatalog?: boolean
    battleBystander?: boolean
    deployWatcher?: boolean
    resolveBystander?: boolean
  },
): void {
  effects.set(name, fn)
  if (opts?.needsCatalog) catalogEffects.add(name)
  if (opts?.battleBystander) bystanderEffects.add(name)
  if (opts?.deployWatcher) deployWatcherEffects.add(name)
  if (opts?.resolveBystander) resolveBystanderEffects.add(name)
}
export function registerCostModifier(name: string, fn: CostModifierFn): void { costModifiers.set(name, fn) }
export const effectFor = (name: string): EffectFn | null => effects.get(name) ?? null
export const costModifierFor = (name: string): CostModifierFn | null => costModifiers.get(name) ?? null
export const isImplemented = (name: string): boolean => effects.has(name) || costModifiers.has(name)

// Every name registered so far, effects and cost modifiers alike. Exists for
// G4 in supabase/seed/effectCoverage.test.ts, which closes the guard's
// blind spot 5 by asking the question from the OTHER end: not "is this card's
// effect implemented?" but "does any card name this implementation?".
//
// Deleting a card's meta key orphans its implementation silently — the
// 2026-08-30 balance pass did exactly that to three of them — and nothing
// else in the suite would notice.
export const registeredEffectNames = (): string[] =>
  [...new Set([...effects.keys(), ...costModifiers.keys()])].sort()

// Two seeded rows carry trailing spaces in their effect names — trim on read.
export function effectName(card: { meta: Record<string, unknown> }, triggerKey: string): string | null {
  const raw = card.meta[triggerKey]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

const ALL_META_KEYS = [...Object.values(TRIGGERS), 'costModifier']

// Meta keys that carry plain data rather than an effect name, and which
// satisfy a card's text on their own (spec §5).
// Buzzsaw and Veles USED TO carry `defensiveOmission` and no registry name at
// all (spec §4.8): an effect returns a boolean meaning "resolved" and may
// mutate, so using one as a pure eligibility predicate inverts this registry's
// contract. Neither card carries it since the 2026-09-02 pass, and the key
// stays in this list for the frozen snapshots that still do (spec R-8). It
// sits OUTSIDE TRIGGERS deliberately, so G3 never inspects it and HandBar's
// ALL_TRIGGER_KEYS needs no change.
// `aircraftLock` (wave 6) joins them for the same reason: Albacore and Tarpon
// print one sentence, that sentence IS a placement rule read by
// legalZonesFor, and neither card carries a registry name at all.
// Purifier's two (wave 6) are both here for the same reason: its whole card
// text is those two rules, and it names no effect at all.
// `deployOrder` (2026-09-02 spec §4.3) is the same case again, twice over: WF
// Veles and TG Anguish each print ONE sentence, that sentence IS the
// deployment-order rule, and neither card names a registry effect. Without it
// here, G2 reports both as silent and noteUnimplemented logs a
// player-visible "plays as vanilla" note that is false.
export const DATA_EFFECT_KEYS = [
  'additionalSpawns', 'resourceSurge', 'defensiveOmission', 'aircraftLock',
  'deployRequiresBattleLoss', 'noBaseDamage', 'deployRequiresAiVehicle',
  'deployOrder',
] as const

// Spec §3.9: cards referencing unimplemented effects play as vanilla, with a
// note appended to the game log at play time. A card whose text names no
// effect at all gets its own note — otherwise it would fail in total silence.
export function noteUnimplemented(game: EngineGame, card: CardInstance): void {
  let namedAny = false
  for (const key of ALL_META_KEYS) {
    const name = effectName(card, key)
    if (name === null) continue
    namedAny = true
    if (isImplemented(name)) continue
    game.state.log.push(`${card.name}: effect "${name}" is not implemented yet — plays as vanilla`)
  }
  // A card that named any effect already had its say above — implemented
  // ones work, unimplemented ones were just reported.
  if (namedAny) return
  const hasData = DATA_EFFECT_KEYS.some((k) => card.meta[k] !== undefined && card.meta[k] !== null)
  if (!hasData && card.cardText.trim() !== '') {
    game.state.log.push(`${card.name}: its card text has no implemented effect yet — plays as vanilla`)
  }
}
