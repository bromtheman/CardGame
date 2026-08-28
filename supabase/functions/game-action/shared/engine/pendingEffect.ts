import { err, registerHandler } from './gameEngine.ts'
import { effectFor } from '../effects/registry.ts'

// DP4's second half. The slot is cleared BEFORE the effect runs, so a
// continuation may suspend again (wave 3's Trebuchet repeats itself). When
// the effect reports failure, applyAction discards the whole clone, so the
// real row keeps its pending slot and the player can answer again.
registerHandler('RESOLVE_PENDING_EFFECT', (game, actor, action, ctx) => {
  if (action.type !== 'RESOLVE_PENDING_EFFECT') return err(400, 'Bad action')
  const pending = game.state.pendingEffect
  if (!pending) return err(409, 'Nothing is waiting on a choice')
  if (pending.side !== actor) return err(403, 'That choice belongs to your opponent')

  if (action.cancel === true) {
    game.state.pendingEffect = null
    game.state.log.push(`${pending.card.name}'s effect was declined`)
    return { ok: true, game }
  }

  const fn = effectFor(pending.effect)
  game.state.pendingEffect = null
  // A deploy that rolled back under a live suspension would otherwise leave a
  // game neither player could advance. Drop the choice and say so.
  if (!fn) {
    game.state.log.push(`${pending.card.name}'s effect is no longer available — the choice was dropped`)
    return { ok: true, game }
  }

  const resolved = fn({
    game,
    actor,
    card: pending.card,
    ctx,
    pending,
    resolution: {
      choiceId: action.choiceId,
      targetInstanceId: action.targetInstanceId,
      zoneId: action.zoneId,
    },
  })
  if (!resolved) return err(400, `${pending.card.name}'s effect could not resolve — check your choice`)
  return { ok: true, game }
})
