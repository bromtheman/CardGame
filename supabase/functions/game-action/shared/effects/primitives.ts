import type { CardInstance } from '../engine/gameInit.ts'
import type { EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
import { drawCard, otherSide } from '../engine/gameEngine.ts'
import type { EffectFn, EffectPayload } from './registry.ts'

// Move one card from the enemy's deck into the actor's hand. The log line
// must not name it — it is going into a hidden hand. A fresh instanceId is
// minted because the card is changing owners.
export function takeFromEnemyDeck(
  game: EngineGame, actor: Side, ctx: EngineContext,
  filter?: (card: CardInstance) => boolean,
): boolean {
  const enemy = otherSide(actor)
  const deck = game.privates[enemy].deck
  const index = filter ? deck.findIndex(filter) : (deck.length > 0 ? 0 : -1)
  if (index < 0) {
    game.state.log.push(`Player ${actor.toUpperCase()} finds nothing to take from the enemy deck`)
    return true
  }
  const [card] = deck.splice(index, 1)
  game.privates[actor].hand.push({ ...card, instanceId: ctx.newId() })
  game.state.counts[actor].hand = game.privates[actor].hand.length
  game.state.counts[enemy].deck = deck.length
  game.state.log.push(`Player ${actor.toUpperCase()} takes a card from the enemy deck`)
  return true
}

export interface GrantSpec {
  draw?: number
  cp?: number
  materials?: number
  from?: 'own' | 'enemy'
}

// Draw cards and/or add CP and materials. The workhorse: 17 built-in cards
// are nothing more than one of these.
export function grant(spec: GrantSpec): EffectFn {
  return ({ game, actor, ctx }) => {
    for (let i = 0; i < (spec.draw ?? 0); i++) {
      if (spec.from === 'enemy') takeFromEnemyDeck(game, actor, ctx)
      else drawCard(game, actor, ctx)
    }
    if (spec.cp) game.state.resources[actor].cp += spec.cp
    if (spec.materials) game.state.resources[actor].materials += spec.materials
    return true
  }
}

// Run effects in order, stopping at the first failure.
export function sequence(...fns: EffectFn[]): EffectFn {
  return (payload) => {
    for (const fn of fns) if (!fn(payload)) return false
    return true
  }
}

export interface PoolFilter {
  faction?: string
  vehicleType?: string
  type?: string
  isBuiltIn?: boolean
  maxCost?: number
  minCost?: number
}

export interface PoolSpec {
  source: 'catalog' | 'deck'
  filter: PoolFilter
  count: number
  strip?: string[]
  // Catalog pools that come up empty are a data bug and fail. Deck pools are
  // often legitimately empty ("if you have one"), so those opt into a note.
  allowEmpty?: boolean
}

// Cost filters read the printed materialCost — "base cost" in card text —
// never effectiveMaterialCostOf.
function matches(card: { faction: string; vehicleType: string | null; type: string; isBuiltIn: boolean; materialCost: number }, f: PoolFilter): boolean {
  if (f.faction !== undefined && card.faction !== f.faction) return false
  if (f.vehicleType !== undefined && card.vehicleType !== f.vehicleType) return false
  if (f.type !== undefined && card.type !== f.type) return false
  if (f.isBuiltIn !== undefined && card.isBuiltIn !== f.isBuiltIn) return false
  if (f.maxCost !== undefined && card.materialCost > f.maxCost) return false
  if (f.minCost !== undefined && card.materialCost < f.minCost) return false
  return true
}

function shuffled<T>(items: T[], ctx: EngineContext): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Put `count` cards matching `filter` into the actor's hand, either minted
// from the built-in catalog or moved out of the actor's own deck. The log
// never names them — they are entering a hidden hand.
export function drawFromPool(spec: PoolSpec): EffectFn {
  return ({ game, actor, ctx }) => {
    const hand = game.privates[actor].hand
    if (spec.source === 'catalog') {
      const pool = ctx.catalog.filter((c) => c.isBuiltIn && matches(c, spec.filter))
      if (pool.length === 0) {
        if (!spec.allowEmpty) return false
        game.state.log.push(`Player ${actor.toUpperCase()} finds no matching card`)
        return true
      }
      for (const pick of shuffled(pool, ctx).slice(0, spec.count)) {
        hand.push({
          ...pick,
          instanceId: ctx.newId(),
          keywords: spec.strip ? pick.keywords.filter((k) => !spec.strip!.includes(k)) : pick.keywords,
        })
      }
    } else {
      const deck = game.privates[actor].deck
      const pool = deck.filter((c) => matches(c, spec.filter))
      if (pool.length === 0) {
        if (!spec.allowEmpty) return false
        game.state.log.push(`Player ${actor.toUpperCase()} finds no matching card in their deck`)
        return true
      }
      for (const pick of shuffled(pool, ctx).slice(0, spec.count)) {
        const index = deck.findIndex((c) => c.instanceId === pick.instanceId)
        if (index < 0) continue
        const [card] = deck.splice(index, 1)
        hand.push(spec.strip ? { ...card, keywords: card.keywords.filter((k) => !spec.strip!.includes(k)) } : card)
      }
      game.privates[actor].deck = deck
    }
    game.state.counts[actor] = { hand: hand.length, deck: game.privates[actor].deck.length }
    game.state.log.push(`Player ${actor.toUpperCase()} adds a card to their hand`)
    return true
  }
}

// Vehicles already in the target zone, excluding whatever this play just
// placed. `side: 'own'` counts only the actor's; 'either' counts both.
export function zoneOccupants(p: EffectPayload, side: 'own' | 'either'): CardInstance[] {
  const zone = p.game.state.zones.find((z) => z.id === p.targetZoneId)
  if (!zone) return []
  const placed = new Set(p.placedInstanceIds ?? [])
  const mine = zone.cards[p.actor].filter((c) => !placed.has(c.instanceId))
  if (side === 'own') return mine
  const theirs = zone.cards[otherSide(p.actor)].filter((c) => !placed.has(c.instanceId))
  return [...mine, ...theirs]
}

// Run `body` only when `predicate` holds. A false predicate is not a
// failure — the effect resolved, it simply did nothing.
export function whenPlayed(predicate: (p: EffectPayload) => boolean, body: EffectFn): EffectFn {
  return (payload) => (predicate(payload) ? body(payload) : true)
}
