import type { CardInstance } from '../engine/gameInit.ts'
import type { EngineContext, EngineGame, Side } from '../engine/engineTypes.ts'
import { drawCard, otherSide } from '../engine/gameEngine.ts'
import type { EffectFn } from './registry.ts'

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
