import { TRIGGERS } from '../gameSettings.ts'
import type { BattleContinuation, EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
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
}
export type EffectFn = (payload: EffectPayload) => boolean
export type CostModifierFn = (state: PublicGameState, side: Side, card: CardInstance) => number

const effects = new Map<string, EffectFn>()
const costModifiers = new Map<string, CostModifierFn>()

// Effects that need the built-in card catalog supplied via EngineContext.
// Derived from registration so it can never drift from the implementations.
const catalogEffects = new Set<string>()
export const CATALOG_EFFECTS: ReadonlySet<string> = catalogEffects

export function registerEffect(
  name: string, fn: EffectFn, opts?: { needsCatalog?: boolean },
): void {
  effects.set(name, fn)
  if (opts?.needsCatalog) catalogEffects.add(name)
}
export function registerCostModifier(name: string, fn: CostModifierFn): void { costModifiers.set(name, fn) }
export const effectFor = (name: string): EffectFn | null => effects.get(name) ?? null
export const costModifierFor = (name: string): CostModifierFn | null => costModifiers.get(name) ?? null
export const isImplemented = (name: string): boolean => effects.has(name) || costModifiers.has(name)

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
export const DATA_EFFECT_KEYS = ['additionalSpawns', 'resourceSurge'] as const

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
