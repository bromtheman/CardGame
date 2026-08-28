import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction } from './index.ts'
import { registerEffect } from '../effects/registry.ts'
import { choice } from '../effects/primitives.ts'
import { inst, makeCtx, makeGame } from './testFixtures.ts'

beforeAll(() => {
  registerEffect('t_resolvable', choice({
    effect: 't_resolvable',
    prompt: 'Pick one',
    options: () => [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
    resolve: ({ game }, choiceId) => { game.state.log.push(`picked:${choiceId}`); return true },
  }))
})

function frozen(side: 'a' | 'b' = 'a', effect = 't_resolvable') {
  const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
  game.state.pendingEffect = {
    effect, side, card: inst({ name: 'Chooser', instanceId: 'c1' }),
    kind: 'choice', prompt: 'Pick one',
    options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
  }
  return game
}

describe('RESOLVE_PENDING_EFFECT', () => {
  it('resolves the choice and clears the slot', () => {
    const res = applyAction(frozen(), 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'b' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log.join()).toContain('picked:b')
  })

  it('rejects the side that does not owe the choice', () => {
    const game = frozen('b')
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 403 })
  })

  // Regression: RESOLVE_PENDING_EFFECT must be legal for whichever side owes
  // the choice, even when that side is not the active player (e.g. a death
  // effect suspended for the non-active player). Before OFF_TURN_ACTIONS
  // included this action type, applyAction's turn check rejected the owing
  // off-turn player with 409 "Not your turn" before the handler's own
  // ownership check ever ran — leaving no one able to resolve, or even
  // cancel, the choice.
  it('lets the off-turn player resolve a choice owed to them while the other side is active', () => {
    const game = frozen('b') // pendingEffect.side: 'b', activePlayer: alice
    const res = applyAction(game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log.join()).toContain('picked:a')
  })

  it('lets the off-turn player cancel a choice owed to them while the other side is active', () => {
    const game = frozen('b') // pendingEffect.side: 'b', activePlayer: alice
    const res = applyAction(game, 'bob', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log.join()).not.toContain('picked:')
    expect(res.game.state.log.join()).toContain('declined')
  })

  it('rejects when nothing is pending', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('keeps the slot intact when the choiceId is unknown', () => {
    const game = frozen()
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'zzz' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 400 })
    expect(game.state.pendingEffect).not.toBeNull()
  })

  it('cancel clears the slot without resolving', () => {
    const res = applyAction(frozen(), 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
    expect(res.game.state.log.join()).not.toContain('picked:')
    expect(res.game.state.log.join()).toContain('declined')
  })

  it('clears the slot rather than bricking the game when the effect is gone', () => {
    const res = applyAction(
      frozen('a', 't_neverRegistered'), 'alice',
      { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx(),
    )
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.pendingEffect).toBeNull()
  })

  it('unfreezes the game once resolved', () => {
    const res = applyAction(frozen(), 'alice', { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'a' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    const next = applyAction(res.game, 'alice', { type: 'END_TURN' }, makeCtx())
    expect(next.ok).toBe(true)
  })
})
