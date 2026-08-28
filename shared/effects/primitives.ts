import type { CardInstance } from '../engine/gameInit.ts'
import type { EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
import { drawCard, findVehicle, otherSide } from '../engine/gameEngine.ts'
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
  // Catalog pools that come up empty are a data bug and fail by default. Deck
  // pools are often legitimately empty ("if you have one" is printed on the
  // card), so a deck source defaults to allowEmpty — pass false to require a
  // match instead.
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
    const allowEmpty = spec.allowEmpty ?? spec.source === 'deck'
    if (spec.source === 'catalog') {
      const pool = ctx.catalog.filter((c) => c.isBuiltIn && matches(c, spec.filter))
      if (pool.length === 0) {
        if (!allowEmpty) return false
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
        if (!allowEmpty) return false
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
// Returns null when there is no target zone at all — callers building a
// whenPlayed predicate must not read that the same as an empty zone (an
// empty array), or a reachable-but-targetless play would satisfy an
// "is the zone empty?" check it never should.
export function zoneOccupants(p: EffectPayload, side: 'own' | 'either'): CardInstance[] | null {
  const zone = p.game.state.zones.find((z) => z.id === p.targetZoneId)
  if (!zone) return null
  const placed = new Set(p.placedInstanceIds ?? [])
  const mine = zone.cards[p.actor].filter((c) => !placed.has(c.instanceId))
  if (side === 'own') return mine
  const theirs = zone.cards[otherSide(p.actor)].filter((c) => !placed.has(c.instanceId))
  return [...mine, ...theirs]
}

// Run `body` only when `predicate` holds. A false predicate is not a
// failure — the effect resolved, it simply did nothing. A predicate built
// around zoneOccupants must treat its null (no such zone) as "does not
// hold" — see zoneOccupants and its two call sites.
export function whenPlayed(predicate: (p: EffectPayload) => boolean, body: EffectFn): EffectFn {
  return (payload) => (predicate(payload) ? body(payload) : true)
}

// Stamp a persistent per-instance cost change onto a card in the actor's
// hand, the way doubleUpEffect stamps additionalSpawns. Read only by
// effectiveCostInGame — never by effectiveMaterialCostOf.
export function costDelta(spec: { delta: number; filter: PoolFilter }): EffectFn {
  return ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
    if (!target || !matches(target, spec.filter)) return false
    const current = typeof target.meta.costDelta === 'number' ? target.meta.costDelta : 0
    target.meta = { ...target.meta, costDelta: current + spec.delta }
    return true
  }
}

// Add keywords to a card, either in the actor's hand or anywhere on the
// field. Idempotent — a keyword the target already carries is not duplicated.
export function grantKeywords(spec: {
  keywords: string[]
  target: 'hand' | 'field'
  filter?: PoolFilter
}): EffectFn {
  return ({ game, actor, targetInstanceId }) => {
    if (typeof targetInstanceId !== 'string') return false
    const card = spec.target === 'hand'
      ? game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
      : findVehicle(game.state, targetInstanceId)?.entry
    if (!card) return false
    if (spec.filter && !matches(card, spec.filter)) return false
    card.keywords = [...card.keywords, ...spec.keywords.filter((k) => !card.keywords.includes(k))]
    return true
  }
}

export interface ChoiceOption { id: string; label: string }

// Suspend for a player decision (spec §4.2, DP4). First entry writes
// state.pendingEffect and returns true; RESOLVE_PENDING_EFFECT re-enters the
// same registry name with `resolution` set and runs `resolve`.
//
// Empty options do NOT suspend — they call resolve(payload, null) straight
// away, so a card whose choice is optional still runs its tail. Kraken needs
// exactly this: "refresh one of your hero powers then gain 1cp" must still
// grant the CP for a player with no used powers.
export function choice(spec: {
  effect: string
  prompt: string
  options: (p: EffectPayload) => ChoiceOption[]
  data?: (p: EffectPayload) => Record<string, unknown>
  resolve: (p: EffectPayload, choiceId: string | null) => boolean
}): EffectFn {
  return (payload) => {
    if (payload.resolution === undefined) {
      const options = spec.options(payload)
      if (options.length === 0) return spec.resolve(payload, null)
      payload.game.state.pendingEffect = {
        effect: spec.effect,
        side: payload.actor,
        card: payload.card,
        kind: 'choice',
        prompt: spec.prompt,
        options,
        data: spec.data ? spec.data(payload) : undefined,
      }
      payload.game.state.log.push(`${payload.card.name} is waiting on a choice`)
      return true
    }
    const chosen = payload.resolution.choiceId
    const known = payload.pending?.options ?? []
    if (typeof chosen !== 'string' || !known.some((o) => o.id === chosen)) return false
    return spec.resolve(payload, chosen)
  }
}
