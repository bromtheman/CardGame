import { beforeAll, describe, expect, it } from 'vitest'
import { applyAction, declareForcedBattle, knownActionTypes } from './index.ts'
import type { EngineGame, GameAction } from './engineTypes.ts'
import { registerEffect } from '../effects/registry.ts'
import { makeCtx, makeGame, zoneEntry } from './testFixtures.ts'

// Decision 19 / spec §4.3, DP2 departure 3: wave 4 is the first time
// state.pendingEffect and state.activeBattle can be non-null at once. Terawatt
// and DWG Waters' clause 2 both suspend at battle lock, so this is not an
// exotic corner — it is the ordinary path for two shipped cards.
//
// The invariant is proved here against a SYNTHETIC effect rather than through
// either card, so it keeps testing the freeze even if both cards later change
// or are removed. gameEngine.ts's applyAction is what makes it safe:
//   - the pendingEffect check runs BEFORE the battle check and admits only
//     PENDING_ACTIONS;
//   - `pendingAdmitted` stops the battle check from also rejecting the one
//     action that can clear the slot;
//   - RESOLVE_PENDING_EFFECT is an OFF_TURN_ACTION, which is what lets the
//     DEFENDER answer on the aggressor's turn.
// None of that is new code. This file exists to pin it before two cards start
// depending on it.

beforeAll(() => {
  // Terawatt's shape: a bystander that suspends at forced-battle lock. First
  // entry writes the slot; re-entry (resolution set) just reports success.
  registerEffect('t_lockChooser', ({ game, actor, card, resolution }) => {
    if (resolution !== undefined) {
      game.state.log.push('t_lockChooser answered')
      return true
    }
    game.state.pendingEffect = {
      effect: 't_lockChooser', side: actor, card, kind: 'choice',
      prompt: 'Join the battle?', options: [{ id: 'join', label: 'Join' }],
    }
    return true
  }, { battleBystander: true })

  // Wave 6 / DP7: an ON-PLAY effect that suspends. Paired with a blockade
  // rider it produces the doubly-frozen state from the opposite direction —
  // choice first, battle second.
  registerEffect('t_freezeSuspend', ({ game, actor, card, resolution }) => {
    if (resolution !== undefined) return true
    game.state.pendingEffect = {
      effect: 't_freezeSuspend', side: actor, card, kind: 'choice',
      prompt: 'Choose something', options: [{ id: 'x', label: 'X' }],
    }
    return true
  })
})

// alice is side a and the active player; bob is side b. The forced battle is
// declared BY alice, so the choice it raises is owed by bob — off-turn, which
// is the case that matters.
function bothFrozen() {
  const g = makeGame({ turnNumber: 3, activePlayer: 'alice' })
  const attacker = zoneEntry({ name: 'Aggressor', playedOnTurn: 2 })
  const defender = zoneEntry({ name: 'Lone Defender' })
  const chooser = zoneEntry({ name: 'Terawatt-ish', meta: { onBattleEffect: 't_lockChooser' } })
  g.state.zones[0].cards.a.push(attacker)
  g.state.zones[0].cards.b.push(defender, chooser)
  const declared = declareForcedBattle(g, makeCtx(), {
    zoneId: 1, aggressor: 'a',
    attackerIds: [attacker.instanceId], defenderIds: [defender.instanceId],
    cause: 'Gang Up',
  })
  if (!declared) throw new Error('fixture: the forced battle was refused')
  return { g, attacker, defender, chooser }
}

// One representative payload per action type. The sweep below asserts this
// covers every type applyAction can dispatch, so a new action type fails this
// file until someone decides how it behaves under the two freezes.
const SAMPLES: Record<string, GameAction> = {
  END_TURN: { type: 'END_TURN' },
  CONCEDE: { type: 'CONCEDE' },
  ABANDON: { type: 'ABANDON' },
  PLAY_CARD_TO_ZONE: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 1 },
  PLAY_ABILITY_CARD: { type: 'PLAY_ABILITY_CARD', instanceId: 'x' },
  PLAY_CARD_TARGETING_CARD_ON_FIELD: {
    type: 'PLAY_CARD_TARGETING_CARD_ON_FIELD', instanceId: 'x', targetInstanceId: 'y',
  },
  PLAY_CARD_TARGETING_CARD_IN_HAND: {
    type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: 'x', targetInstanceId: 'y',
  },
  MOVE_VEHICLE: { type: 'MOVE_VEHICLE', instanceId: 'x', zoneId: 2 },
  ACTIVATE_VEHICLE: { type: 'ACTIVATE_VEHICLE', instanceId: 'x' },
  ATTACK_ENEMY_BASE: { type: 'ATTACK_ENEMY_BASE', zoneId: 2 },
  ATTACK_ENEMY_FLEET: { type: 'ATTACK_ENEMY_FLEET', zoneId: 2, attackerIds: ['x'], targetIds: ['y'] },
  RESPOND_TO_ATTACK: { type: 'RESPOND_TO_ATTACK', optOutIds: [] },
  SUBMIT_BATTLE_REPORT: { type: 'SUBMIT_BATTLE_REPORT', results: {}, repairs: [] },
  DECIDE_BATTLE_REPORT: { type: 'DECIDE_BATTLE_REPORT', approve: true },
  SET_ALERT_CARD: { type: 'SET_ALERT_CARD', instanceId: 'x' },
  USE_HERO_POWER: { type: 'USE_HERO_POWER', power: 'draw' },
  RESOLVE_PENDING_EFFECT: { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'join' },
}

const ADMITTED = ['RESOLVE_PENDING_EFFECT', 'CONCEDE', 'ABANDON']

function settle(game: EngineGame, ids: string[]) {
  const results = Object.fromEntries(ids.map((id) => [id, 95]))
  const s = applyAction(game, 'alice', { type: 'SUBMIT_BATTLE_REPORT', results, repairs: [] }, makeCtx())
  if (!s.ok) throw new Error(`submit: ${s.error}`)
  const d = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
  if (!d.ok) throw new Error(`decide: ${d.error}`)
  return d.game
}

describe('both freezes set at once', () => {
  it('a battle-lock choice leaves pendingEffect AND activeBattle non-null', () => {
    const { g } = bothFrozen()
    expect(g.state.activeBattle).not.toBeNull()
    expect(g.state.pendingEffect).not.toBeNull()
    expect(g.state.pendingEffect?.side).toBe('b')
  })

  it('the sweep below covers every action type applyAction can dispatch', () => {
    expect([...knownActionTypes()].sort()).toEqual(Object.keys(SAMPLES).sort())
  })

  it('rejects every action except RESOLVE_PENDING_EFFECT, CONCEDE and ABANDON', () => {
    for (const [type, action] of Object.entries(SAMPLES)) {
      if (ADMITTED.includes(type)) continue
      for (const who of ['alice', 'bob']) {
        const { g } = bothFrozen()
        const r = applyAction(g, who, action, makeCtx())
        expect({ type, who, ok: r.ok }).toEqual({ type, who, ok: false })
        if (!r.ok) expect({ type, who, status: r.status }).toEqual({ type, who, status: 409 })
      }
    }
  })

  // What the ordering of the two checks actually buys. With `pendingAdmitted`
  // in place the two orders reject and admit exactly the same set, so status
  // alone cannot tell them apart — the observable difference is which reason
  // the player is given. A player who owes a choice must be told about the
  // choice, not about the battle underneath it, or the message points them at
  // the one thing they cannot act on.
  it('blames the choice, not the battle, in every rejection', () => {
    for (const [type, action] of Object.entries(SAMPLES)) {
      if (ADMITTED.includes(type)) continue
      const { g } = bothFrozen()
      const r = applyAction(g, 'bob', action, makeCtx())
      if (r.ok) throw new Error(`${type} was admitted`)
      expect({ type, error: r.error }).toEqual({
        type, error: 'A card effect is waiting on a choice — resolve it first',
      })
    }
  })

  // The battle freeze alone would have admitted these three — that is exactly
  // why pendingEffect is its own check, ahead of it (spec §4.2, departure 2).
  it('rejects the battle actions and the hero power the battle freeze would admit', () => {
    for (const type of ['SUBMIT_BATTLE_REPORT', 'DECIDE_BATTLE_REPORT', 'USE_HERO_POWER']) {
      const { g } = bothFrozen()
      const r = applyAction(g, 'bob', SAMPLES[type], makeCtx())
      expect({ type, ok: r.ok }).toEqual({ type, ok: false })
    }
  })

  it('lets the off-turn owed side answer, and refuses the on-turn side', () => {
    const { g } = bothFrozen()
    expect(applyAction(g, 'alice', SAMPLES.RESOLVE_PENDING_EFFECT, makeCtx()))
      .toMatchObject({ ok: false, status: 403 })
    const r = applyAction(g, 'bob', SAMPLES.RESOLVE_PENDING_EFFECT, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect).toBeNull()
    expect(r.game.state.log.join('\n')).toContain('t_lockChooser answered')
  })

  it('leaves the battle standing and reportable once the choice is answered', () => {
    const { g, attacker, defender } = bothFrozen()
    const answered = applyAction(g, 'bob', SAMPLES.RESOLVE_PENDING_EFFECT, makeCtx())
    if (!answered.ok) throw new Error(answered.error)
    expect(answered.game.state.activeBattle).not.toBeNull()
    const out = settle(answered.game, [attacker.instanceId, defender.instanceId])
    expect(out.state.activeBattle).toBeNull()
    expect(out.state.pendingReport).toBeNull()
  })

  // Declining is the escape hatch that stops a misclick stranding a game, so
  // it has to leave the battle in exactly the same reportable state.
  it('leaves the battle standing and reportable when the choice is declined', () => {
    const { g, attacker, defender } = bothFrozen()
    const declined = applyAction(g, 'bob', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    if (!declined.ok) throw new Error(declined.error)
    expect(declined.game.state.pendingEffect).toBeNull()
    expect(declined.game.state.activeBattle).not.toBeNull()
    const out = settle(declined.game, [attacker.instanceId, defender.instanceId])
    expect(out.state.activeBattle).toBeNull()
  })

  // The rollback escape: a deploy that unregistered the effect under a live
  // suspension must not leave a game neither player can advance — and here
  // there is a battle underneath it that still has to be reportable.
  it('drops a suspension whose effect is gone, and still resolves the battle', () => {
    const { g, attacker, defender } = bothFrozen()
    g.state.pendingEffect = { ...g.state.pendingEffect!, effect: 't_neverRegisteredFreezeEffect' }
    const r = applyAction(g, 'bob', SAMPLES.RESOLVE_PENDING_EFFECT, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.pendingEffect).toBeNull()
    const out = settle(r.game, [attacker.instanceId, defender.instanceId])
    expect(out.state.activeBattle).toBeNull()
  })

  it('still allows conceding out of the doubly-frozen state', () => {
    const { g } = bothFrozen()
    const r = applyAction(g, 'bob', { type: 'CONCEDE' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })
})

// Wave 6 / DP7. A new ORDERING for the doubly-frozen state: everything above
// reaches it from a battle lock that raises a choice. DP7 reaches it from the
// other direction — a play whose own on-play effect suspends, and which THEN
// springs a blockade, so the battle is declared while a choice is already
// owed. The freeze rules are the same ones; only the arrival is new.
//
// Synthetic throughout: a t_-prefixed suspending effect and a hand-built
// blockade rider, so this keeps testing the invariant if SS Blockade changes.
describe('DP7 — a play that suspends AND springs a blockade', () => {
  function sprung() {
    const g = makeGame({ turnNumber: 3 })
    g.state.zoneEffects.push({
      effect: 'blockadeEffect', zoneId: 1, side: 'b', cardName: 'Blockade', setOnTurn: 2,
    })
    const guard = zoneEntry({ instanceId: 'guard', name: 'Guard' })
    g.state.zones[0].cards.b.push(guard)
    const card = {
      ...zoneEntry({ name: 'Suspender', vehicleType: 'ship', materialCost: 0 }),
      meta: { onPlayEffect: 't_freezeSuspend' },
    }
    g.privates.a.hand = [card]
    g.state.counts.a.hand = 1
    const ctx = makeCtx({
      catalog: [{
        cardId: 'blockade', name: 'Blockade', isBuiltIn: true, ownerId: null, faction: 'SS',
        type: 'ability', vehicleType: null, blueprintCost: 0, materialCost: 0, cpCost: 0,
        cardText: '', imageUrl: '', keywords: [], meta: {},
      }],
    })
    const r = applyAction(
      g, 'alice', { type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: 1 }, ctx,
    )
    if (!r.ok) throw new Error(r.error)
    return { game: r.game, ctx, card }
  }

  it('leaves BOTH freezes set — the choice is owed and the battle stands', () => {
    const { game } = sprung()
    expect(game.state.pendingEffect).not.toBeNull()
    expect(game.state.activeBattle).not.toBeNull()
    expect(game.state.activeBattle!.aggressor).toBe('b')
  })

  it('still admits only PENDING_ACTIONS while the choice is owed', () => {
    const { game, ctx } = sprung()
    // A battle action BATTLE_ACTIONS would otherwise allow.
    expect(applyAction(game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: {}, repairs: [],
    }, ctx)).toMatchObject({ ok: false, status: 409 })
    // And the escape hatch is still reachable, by the player who owes it.
    const cleared = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ctx)
    if (!cleared.ok) throw new Error(cleared.error)
    expect(cleared.game.state.pendingEffect).toBeNull()
    expect(cleared.game.state.activeBattle).not.toBeNull()
  })

  it('reports the battle normally once the choice is answered', () => {
    const { game, ctx, card } = sprung()
    const cleared = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, ctx)
    if (!cleared.ok) throw new Error(cleared.error)
    const submitted = applyAction(cleared.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { guard: 100, [card.instanceId]: 0 }, repairs: [],
    }, ctx)
    if (!submitted.ok) throw new Error(submitted.error)
    const decided = applyAction(submitted.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, ctx)
    if (!decided.ok) throw new Error(decided.error)
    expect(decided.game.state.activeBattle).toBeNull()
  })
})
