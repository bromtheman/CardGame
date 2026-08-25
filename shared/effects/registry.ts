import { TRIGGERS } from '../gameSettings.ts'
import type { EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
import type { CardInstance, PublicGameState } from '../engine/gameInit.ts'

export interface EffectPayload {
  game: EngineGame
  actor: Side
  card: CardInstance
  ctx: EngineContext
  targetZoneId?: number
  targetInstanceId?: string
}
export type EffectFn = (payload: EffectPayload) => boolean
export type CostModifierFn = (state: PublicGameState, side: Side, card: CardInstance) => number

const effects = new Map<string, EffectFn>()
const costModifiers = new Map<string, CostModifierFn>()

// Effects that need the built-in card catalog supplied via EngineContext.
export const CATALOG_EFFECTS = new Set(['reservesEffect', 'spawnBuccaneerEffect'])

export function registerEffect(name: string, fn: EffectFn): void { effects.set(name, fn) }
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

// Spec §3.9: cards referencing unimplemented effects play as vanilla, with a
// note appended to the game log at play time.
export function noteUnimplemented(game: EngineGame, card: CardInstance): void {
  for (const key of ALL_META_KEYS) {
    const name = effectName(card, key)
    if (name !== null && !isImplemented(name)) {
      game.state.log.push(`${card.name}: effect "${name}" is not implemented yet — plays as vanilla`)
    }
  }
}
