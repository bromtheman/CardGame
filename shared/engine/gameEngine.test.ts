import { describe, expect, it } from 'vitest'
import { LOG_MAX_ENTRIES } from '../gameSettings'
import { applyAction, effectiveCostInGame, normalizeState } from './index'
import { takeFromEnemyDeck } from '../effects/primitives.ts'
import { inst, makeCtx, makeGame, snap, zoneEntry } from './testFixtures'

describe('guards', () => {
  it('rejects non-participants and finished games', () => {
    const g = makeGame()
    expect(applyAction(g, 'mallory', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 403 })
    const done = makeGame({ status: 'complete' })
    expect(applyAction(done, 'alice', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
  it('rejects turn actions from the non-active player', () => {
    const g = makeGame() // alice active
    expect(applyAction(g, 'bob', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
  it('never mutates its input', () => {
    const g = makeGame()
    const before = JSON.stringify(g)
    applyAction(g, 'alice', { type: 'END_TURN' })
    expect(JSON.stringify(g)).toBe(before)
  })
  it('freezes non-battle actions during a battle', () => {
    const g = makeGame()
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
      distanceM: 1200, distanceModifiedBy: [],
    }
    expect(applyAction(g, 'alice', { type: 'END_TURN' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('END_TURN', () => {
  it('advances 0.5, flips active player, SETS (not adds) income, draws', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.b.deck = [inst(), inst()]
    g.state.counts.b.deck = 2
    g.state.resources.b.materials = 12345 // sentinel: must be REPLACED, not added to
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.turnNumber).toBe(2.5)
    expect(r.game.activePlayer).toBe('bob')
    expect(r.game.state.resources.b.materials).toBe(100000) // floor(2.5) * 50k exactly
    expect(r.game.privates.b.hand).toHaveLength(1)
    expect(r.game.state.counts.b).toEqual({ hand: 1, deck: 1 })
  })
  it('culls temporary vehicles from both sides at turn start', () => {
    const g = makeGame()
    g.state.zones[0].cards.a.push(zoneEntry({ keywords: ['temporary'], playedOnTurn: 2 }))
    g.state.zones[0].cards.b.push(zoneEntry({}))
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    expect(r.game.state.zones[0].cards.b).toHaveLength(1)
    expect(r.game.state.destroyed.a).toHaveLength(1) // culled temporaries are destroyed (salvageable)
  })
  it('skips the draw on an empty deck and logs it', () => {
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(0)
    expect(r.game.state.log.some((l) => l.includes('no cards left'))).toBe(true)
  })
  it('caps the action log at LOG_MAX_ENTRIES, keeping the newest entries', () => {
    const g = makeGame()
    g.privates.b.deck = [inst()] // avoid an extra "no cards left" log line from the draw
    g.state.counts.b.deck = 1
    for (let i = 0; i < 205; i++) g.state.log.push(`seed entry ${i}`)
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log.length).toBeLessThanOrEqual(LOG_MAX_ENTRIES)
    expect(r.game.state.log[r.game.state.log.length - 1]).toContain('Turn 2.5')
    expect(r.game.state.log[0]).not.toBe('seed entry 0')
    expect(r.game.state.log[r.game.state.log.length - 2]).toBe('seed entry 204')
  })
})

describe('END_TURN alert card expiry', () => {
  it("clears the alert at its owner's END_TURN, with a log note", () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.alertCard = { side: 'a', instanceId: 'x1', name: 'Ambush Alert', setOnTurn: 2 }
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.alertCard).toBeNull()
    expect(r.game.state.log.some((l) => l.includes('Ambush Alert alert expired'))).toBe(true)
  })

  it("does NOT clear the alert when the opponent's turn ends instead", () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.alertCard = { side: 'b', instanceId: 'x1', name: 'Ambush Alert', setOnTurn: 2 }
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.alertCard).not.toBeNull()
    expect(r.game.state.log.some((l) => l.includes('alert expired'))).toBe(false)
  })
})

describe('CONCEDE', () => {
  it('ends the game with the other player winning, from either seat, even off-turn', () => {
    const g = makeGame()
    const r = applyAction(g, 'bob', { type: 'CONCEDE' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.status).toBe('complete')
    expect(r.game.winnerId).toBe('alice')
  })
})

describe('ABANDON', () => {
  it('lets the OFF-TURN player abandon: status abandoned, opponent wins, log line', () => {
    const game = makeGame() // activePlayer 'alice' (side a)
    const r = applyAction(game, 'bob', { type: 'ABANDON' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.game.status).toBe('abandoned')
    expect(r.game.winnerId).toBe('alice')
    expect(r.game.state.log).toContain('Player B abandoned the battle')
  })
  it('works for the active player too, and during a frozen battle', () => {
    const game = makeGame()
    game.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [], defenderIds: [],
      distanceM: 1200, distanceModifiedBy: [],
    }
    const r = applyAction(game, 'alice', { type: 'ABANDON' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.game.status).toBe('abandoned')
    expect(r.game.winnerId).toBe('bob')
  })
  it('rejects abandoning a finished game', () => {
    const game = makeGame({ status: 'complete', winnerId: 'alice' })
    const r = applyAction(game, 'bob', { type: 'ABANDON' })
    expect(r).toEqual({ ok: false, status: 409, error: 'Game is over' })
  })
})

describe('normalizeState', () => {
  it('fills fields missing from pre-Phase-4 game rows', () => {
    const g = makeGame()
    const legacy = g.state as unknown as Record<string, unknown>
    delete legacy.awaitingResponse
    delete legacy.destroyed
    legacy.activeBattle = undefined
    ;(g.state.zones[0].cards.a as unknown[]).push({ ...inst() }) // no playedOnTurn
    normalizeState(g.state)
    expect(g.state.awaitingResponse).toBeNull()
    expect(g.state.activeBattle).toBeNull()
    expect(g.state.destroyed).toEqual({ a: [], b: [] })
    expect(g.state.zones[0].cards.a[0]).toMatchObject({ playedOnTurn: 0 })
    // normalized state passes the frozen check
    expect(applyAction(g, 'alice', { type: 'END_TURN' }).ok).toBe(true)
  })
})

describe('ActiveBattle summons/continuation defaulting (wave 3)', () => {
  // The shape a battle declared by pre-wave-3 code has: no summons, no
  // continuation. This is the row that exists in production the moment
  // this wave deploys — a live game mid-battle (spec §4.4).
  const legacyBattle = (): Record<string, unknown> => ({
    zoneId: 1, aggressor: 'a', attackerIds: ['x'], defenderIds: ['y'],
    distanceM: 1200, distanceModifiedBy: [],
  })

  it('defaults summons to [] on a non-null activeBattle missing it', () => {
    const g = makeGame()
    g.state.activeBattle = { ...legacyBattle(), continuation: null } as never // no summons
    normalizeState(g.state)
    expect(g.state.activeBattle).toMatchObject({ summons: [] })
  })

  it('defaults continuation to null on a non-null activeBattle missing it', () => {
    const g = makeGame()
    g.state.activeBattle = { ...legacyBattle(), summons: [] } as never // no continuation
    normalizeState(g.state)
    expect(g.state.activeBattle).toMatchObject({ continuation: null })
  })

  it('leaves a null activeBattle null and does not throw', () => {
    const g = makeGame() // activeBattle already null
    expect(() => normalizeState(g.state)).not.toThrow()
    expect(g.state.activeBattle).toBeNull()
  })
})

describe('phase 5 state shape', () => {
  it('normalizeState defaults factions, alertCard, and scheduled', () => {
    const game = makeGame()
    const s = game.state as unknown as Record<string, unknown>
    delete s.factions; delete s.alertCard; delete s.scheduled
    normalizeState(game.state)
    expect(game.state.factions).toEqual({ a: 'NEUTRAL', b: 'NEUTRAL' })
    expect(game.state.alertCard).toBeNull()
    expect(game.state.scheduled).toEqual([])
  })
  it('applyAction runs with a default context when none is given', () => {
    const game = makeGame()
    const result = applyAction(game, 'alice', { type: 'END_TURN' })
    expect(result.ok).toBe(true)
  })
})

describe('persistent zone effects', () => {
  it('normalizeState defaults zoneEffects on rows written before the field existed', () => {
    const game = makeGame()
    const s = game.state as unknown as Record<string, unknown>
    delete s.zoneEffects
    normalizeState(game.state)
    expect(game.state.zoneEffects).toEqual([])
  })

  it('playing DWG Waters to a zone records the marker without an unimplemented note', () => {
    const game = makeGame()
    const waters = inst({
      type: 'ability', name: 'DWG Waters', faction: 'DWG', vehicleType: null,
      materialCost: 50_000, meta: { playOnZoneEffect: 'dwgWatersEffect' },
    })
    game.privates.a.hand.push(waters)
    game.state.counts.a.hand = 1
    const result = applyAction(game, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: waters.instanceId, zoneId: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.state.zoneEffects).toMatchObject([
      { effect: 'dwgWatersEffect', zoneId: 2, side: 'a' },
    ])
    expect(result.game.state.log.join('\n')).not.toContain('not implemented yet')
  })
})

describe('deck-out reshuffle', () => {
  it('shuffles the discard back into an empty deck and draws from it', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = [snap({ name: 'Salvaged Hull' }), snap({ name: 'Spent Order' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toHaveLength(1)
    expect(r.game.privates.b.deck).toHaveLength(1)
    expect(r.game.state.destroyed.b).toEqual([])
    expect(r.game.state.counts.b).toEqual({ hand: 1, deck: 1 })
    expect(r.game.state.log.some((l) => l.includes('reshuffles 2 card(s)'))).toBe(true)
  })

  it('gives every reshuffled card a fresh instance id', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = [snap({ name: 'A' }), snap({ name: 'B' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const ids = [...r.game.privates.b.hand, ...r.game.privates.b.deck].map((c) => c.instanceId)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })

  // state.destroyed is public, so an unshuffled recycle would hand both
  // players the exact discard order. This pins the actual permutation the
  // Fisher-Yates loop produces under makeCtx()'s fixed rng cycle
  // [0.1, 0.5, 0.9], for a 3-card pile [A, B, C]:
  //   ids are minted in original pile order, BEFORE the shuffle runs:
  //     A -> e-0, B -> e-1, C -> e-2
  //   loop (i from length-1 down to 1), j = floor(rng() * (i+1)):
  //     i=2: rng()=0.1, j=floor(0.1*3)=0  -> swap(2,0): [C(e-2), B(e-1), A(e-0)]
  //     i=1: rng()=0.5, j=floor(0.5*2)=1  -> swap(1,1): no-op
  //   pushed to the deck as [C(e-2), B(e-1), A(e-0)]; drawCard shifts the
  //   front card (C) into the hand, leaving [B(e-1), A(e-0)] in the deck —
  //   neither the original A/B/C order nor its plain reverse (C/A/B would be
  //   the reverse), so this is sensitive to the shuffle actually running.
  it('pins the exact reshuffled order under the fixed rng, not the original discard order', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = [snap({ name: 'A' }), snap({ name: 'B' }), snap({ name: 'C' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand.map((c) => [c.name, c.instanceId])).toEqual([['C', 'e-2']])
    expect(r.game.privates.b.deck.map((c) => [c.name, c.instanceId])).toEqual([
      ['B', 'e-1'],
      ['A', 'e-0'],
    ])
  })

  it('logs and does not throw when both deck and discard are empty', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = []
    g.state.destroyed.b = []
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand).toEqual([])
    expect(r.game.state.log.some((l) => l.includes('no cards left to draw'))).toBe(true)
  })

  it('does not reshuffle while the deck still has cards', () => {
    const g = makeGame({ activePlayer: 'alice' })
    g.privates.b.deck = [inst({ name: 'Top Card' })]
    g.state.destroyed.b = [snap({ name: 'Stays Discarded' })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.b.hand[0].name).toBe('Top Card')
    expect(r.game.state.destroyed.b).toHaveLength(1)
  })
})

describe('spent ability cards', () => {
  it('sends a played ability card to its owner discard', () => {
    const g = makeGame({ activePlayer: 'alice' })
    const ability = inst({ type: 'ability', name: 'Some Order', materialCost: 0, cardText: '' })
    g.privates.a.hand = [ability]
    g.state.counts.a.hand = 1
    const r = applyAction(g, 'alice', {
      type: 'PLAY_ABILITY_CARD', instanceId: ability.instanceId,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.map((c) => c.name)).toContain('Some Order')
    expect(r.game.privates.a.hand).toEqual([])
  })

  it('does not discard a vehicle played to a zone — it is on the field', () => {
    const g = makeGame({ activePlayer: 'alice' })
    const vehicle = inst({ name: 'Hull', materialCost: 0, vehicleType: 'ship' })
    g.privates.a.hand = [vehicle]
    g.state.counts.a.hand = 1
    const r = applyAction(g, 'alice', {
      type: 'PLAY_CARD_TO_ZONE', instanceId: vehicle.instanceId, zoneId: 1,
    }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a).toEqual([])
    expect(r.game.state.zones[0].cards.a).toHaveLength(1)
  })
})

describe('activatedOnTurn', () => {
  it('normalizeState defaults it to null on a legacy entry', () => {
    const game = makeGame()
    const legacy = zoneEntry({ name: 'Legacy' }) as unknown as Record<string, unknown>
    delete legacy.activatedOnTurn
    game.state.zones[0].cards.a.push(legacy as never)
    normalizeState(game.state)
    expect(game.state.zones[0].cards.a[0]).toHaveProperty('activatedOnTurn', null)
  })

  it('does not leak the stamp into the discard when a Temporary vehicle is culled', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(
      zoneEntry({ name: 'Ghost', keywords: ['temporary'], activatedOnTurn: 2 }),
    )
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.destroyed.a).toHaveLength(1)
    expect(res.game.state.destroyed.a[0]).not.toHaveProperty('activatedOnTurn')
    expect(res.game.state.destroyed.a[0]).not.toHaveProperty('playedOnTurn')
  })
})

describe('pendingEffect freeze', () => {
  const pending = (side: 'a' | 'b' = 'a') => ({
    effect: 't_choice',
    side,
    card: inst({ name: 'Kraken', instanceId: 'k1' }),
    kind: 'choice' as const,
    prompt: 'Pick one',
    options: [{ id: 'x', label: 'X' }],
  })

  it('blocks an ordinary action while a choice is owed', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending()
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('blocks a hero power, which the battle freeze would have allowed', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending()
    const res = applyAction(game, 'alice', { type: 'USE_HERO_POWER', power: 'draw' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('still allows conceding', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending()
    const res = applyAction(game, 'alice', { type: 'CONCEDE' }, makeCtx())
    expect(res.ok).toBe(true)
  })

  it('normalizeState defaults the slot on a legacy row', () => {
    const game = makeGame()
    delete (game.state as unknown as Record<string, unknown>).pendingEffect
    normalizeState(game.state)
    expect(game.state.pendingEffect).toBeNull()
  })
})

describe('summon-only cards', () => {
  it('a summon-only Temporary vehicle despawns without entering the discard', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.zones[0].cards.a.push(zoneEntry({
      name: 'Martyr', keywords: ['temporary'], meta: { summonOnly: true },
    }))
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!res.ok) throw new Error(res.error)
    expect(res.game.state.zones[0].cards.a).toHaveLength(0)
    expect(res.game.state.destroyed.a).toHaveLength(0)
    expect(res.game.state.log.join()).toContain('Martyr despawned')
  })
})

describe('captured cards', () => {
  // Temporary despawn is the third exit a captured card can take (battle
  // death and ability spend are the other two) — all three go home.
  it("despawns a captured Temporary vehicle into its OWNER's discard", () => {
    const g = makeGame()
    g.privates.b.deck.push(
      inst({ name: 'Loaned Skiff', keywords: ['temporary'] }),
      inst({ name: 'Bob Draws This' }),
    )
    g.state.counts.b.deck = 2
    takeFromEnemyDeck(g, 'a', makeCtx())
    g.state.zones[0].cards.a.push(zoneEntry({ ...g.privates.a.hand[0], playedOnTurn: 2 }))
    g.privates.a.hand = []
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b.map((c) => c.name)).toEqual(['Loaned Skiff'])
    expect(r.game.state.destroyed.a).toHaveLength(0)
  })

  // Marauder's own stamp (dwgEffects.ts marauderOnPlay), layered on top of
  // takeFromEnemyDeck's ownerSide — this is the ORIGINAL costDelta consumer
  // and the path discardCard already handled correctly before wave 3's
  // Excalibur fix. Pinned here so the unconditional costDelta strip below
  // cannot regress it back to a captor-side no-op.
  it("strips BOTH costDelta and ownerSide from a captured card going home (Marauder)", () => {
    const g = makeGame()
    // A second, un-captured filler card keeps b's deck non-empty after the
    // capture below — otherwise END_TURN's own draw-for-incoming-side step
    // (b draws next, since alice/side a is ending her turn) would reshuffle
    // and immediately re-draw the very card this test is inspecting,
    // draining state.destroyed.b before the assertions ever see it.
    g.privates.b.deck.push(
      inst({ name: 'Loaned Hull', keywords: ['temporary'], materialCost: 200_000 }),
      inst({ name: 'Bob Draws This Instead' }),
    )
    g.state.counts.b.deck = 2
    takeFromEnemyDeck(g, 'a', makeCtx())
    const taken = g.privates.a.hand[0]
    taken.meta = { ...taken.meta, costDelta: -50_000 } // Marauder's 50k discount
    g.state.zones[0].cards.a.push(zoneEntry({ ...taken, playedOnTurn: 2 }))
    g.privates.a.hand = []
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.b).toHaveLength(1)
    expect(r.game.state.destroyed.b[0].name).toBe('Loaned Hull')
    expect(r.game.state.destroyed.b[0].meta).not.toHaveProperty('costDelta')
    expect(r.game.state.destroyed.b[0].meta).not.toHaveProperty('ownerSide')
  })
})

describe('discardCard strips costDelta unconditionally (wave 3 fix)', () => {
  // A minimal battle fixture — the same shape battleResolve.test.ts's local
  // inBattle() builds, duplicated here (not imported) so this file's tests
  // stay self-contained next to the gameEngine.ts code they exercise.
  // activePlayer starts as 'bob' deliberately: battle actions never touch
  // activePlayer, so bob is still active once the battle resolves, and
  // ending HIS turn is what makes alice (side a) — Ironclad's owner —
  // incoming and drawing next.
  function inBattle() {
    const g = makeGame({ turnNumber: 3, activePlayer: 'bob' })
    const atk = zoneEntry({
      playedOnTurn: 2, materialCost: 300_000, name: 'Ironclad',
      meta: { costDelta: -200_000 }, // Excalibur discounting the OWNER's OWN card
    })
    const def = zoneEntry({ materialCost: 60_000, name: 'Bastion' })
    g.state.zones[0].cards.a.push(atk)
    g.state.zones[0].cards.b.push(def)
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: [atk.instanceId],
      defenderIds: [def.instanceId], distanceM: 1200, distanceModifiedBy: [],
      summons: [], continuation: null,
    }
    g.state.zones[0].lastActivatedTurn = 3
    return { g, atk, def }
  }

  it('(a) a card carrying costDelta that dies in battle lands in state.destroyed with no costDelta', () => {
    const { g, atk, def } = inBattle()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 40, [def.instanceId]: 95 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const r = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a).toHaveLength(1)
    expect(r.game.state.destroyed.a[0].name).toBe('Ironclad')
    expect(r.game.state.destroyed.a[0].meta).not.toHaveProperty('costDelta')
  })

  // The strong assertion: the player-visible consequence. Ironclad dies
  // carrying costDelta, side a's empty deck forces a reshuffle that draws it
  // straight back — and it must cost the full 300k, not the Excalibur-
  // discounted 100k, the second time around.
  it('(b) after a reshuffle it is drawn and prices at FULL cost through effectiveCostInGame', () => {
    const { g, atk, def } = inBattle()
    const s = applyAction(g, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT',
      results: { [atk.instanceId]: 40, [def.instanceId]: 95 }, repairs: [],
    })
    if (!s.ok) throw new Error(s.error)
    const d = applyAction(s.game, 'bob', { type: 'DECIDE_BATTLE_REPORT', approve: true }, makeCtx())
    if (!d.ok) throw new Error(d.error)
    expect(d.game.privates.a.deck).toHaveLength(0) // reshuffle-on-draw precondition
    const t = applyAction(d.game, 'bob', { type: 'END_TURN' }, makeCtx())
    if (!t.ok) throw new Error(t.error)
    expect(t.game.state.log.some((l) => l.includes('reshuffles 1 card(s)'))).toBe(true)
    expect(t.game.state.destroyed.a).toEqual([])
    expect(t.game.privates.a.hand).toHaveLength(1)
    const drawn = t.game.privates.a.hand[0]
    expect(drawn.name).toBe('Ironclad')
    expect(effectiveCostInGame(t.game.state, 'a', drawn)).toBe(300_000)
    expect(drawn.meta).not.toHaveProperty('costDelta')
  })
})

describe('battle-freeze admits what the pending check already allowed (wave 3 fix)', () => {
  const pending = (side: 'a' | 'b' = 'a') => ({
    effect: 't_choice',
    side,
    card: inst({ name: 'Kraken', instanceId: 'k1' }),
    kind: 'choice' as const,
    prompt: 'Pick one',
    options: [{ id: 'x', label: 'X' }],
  })
  const battle = () => ({
    zoneId: 1, aggressor: 'a' as const, attackerIds: ['x'], defenderIds: ['y'],
    distanceM: 1200, distanceModifiedBy: [],
    summons: [], continuation: null,
  })

  it('both freezes set at once: RESOLVE_PENDING_EFFECT { cancel: true } still succeeds and clears the slot', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending('a')
    game.state.activeBattle = battle()
    const res = applyAction(game, 'alice', { type: 'RESOLVE_PENDING_EFFECT', cancel: true }, makeCtx())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.game.state.pendingEffect).toBeNull()
    // cancel only ever clears the choice slot — the battle freeze is a
    // separate concern and is untouched by it.
    expect(res.game.state.activeBattle).not.toBeNull()
  })

  it('lone pendingEffect: an ordinary action is still refused, unchanged', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.pendingEffect = pending('a')
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })

  it('lone activeBattle: a non-battle action is still refused, unchanged', () => {
    const game = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    game.state.activeBattle = battle()
    const res = applyAction(game, 'alice', { type: 'END_TURN' }, makeCtx())
    expect(res).toMatchObject({ ok: false, status: 409 })
  })
})
