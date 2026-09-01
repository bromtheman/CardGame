import { describe, expect, it } from 'vitest'
import { KEYWORDS, LOG_MAX_ENTRIES } from '../gameSettings'
import { applyAction, copyMeta, discardCard, effectiveCostInGame, normalizeState } from './index'
import { takeFromEnemyDeck } from '../effects/primitives.ts'
import type { PublicGameState } from './gameInit.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
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
    // makeGame's settings carry no materialsPerTurn — the default income applies.
    expect(r.game.state.resources.b.materials).toBe(150000) // floor(2.5) * 75k exactly
    expect(r.game.privates.b.hand).toHaveLength(1)
    expect(r.game.state.counts.b).toEqual({ hand: 1, deck: 1 })
  })
  it('scales income by the lobby materialsPerTurn when the host set one', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.settings = { ...g.settings, materialsPerTurn: 120000 }
    g.privates.b.deck = [inst(), inst()]
    g.state.counts.b.deck = 2
    const r = applyAction(g, 'alice', { type: 'END_TURN' })
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(240000) // floor(2.5) * 120k
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
  // Temporary despawn is the third exit a captured copy can take (battle death
  // and ability spend are the other two). All three run through discardCard,
  // so all three destroy it — see 'discardCard destroys captured copies'.
  it('leaves the original drawable while the copy despawns', () => {
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
    expect(r.game.state.destroyed.a).toHaveLength(0)
    expect(r.game.state.destroyed.b).toHaveLength(0)
    // b drew one card on the incoming turn; Loaned Skiff is still theirs,
    // in hand or still in deck.
    expect(r.game.privates.b.deck.concat(r.game.privates.b.hand).map((c) => c.name))
      .toContain('Loaned Skiff')
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

// DP5's turn-end pass (spec §4.3, "DP5 as wave 5 built it"). It runs for the
// side whose turn is ENDING, before the turn number moves, which is the whole
// reason it exists: the older scheduled loop below it runs after the flip and
// serves the INCOMING side, so the earliest it can fire for the acting player
// is a full round later — and every wave-5 tail reads "…the turn", meaning the
// actor's own (spec §7.3).
describe('END_TURN — rest-of-turn riders expire for the ending side', () => {
  const rider = (over: Partial<PublicGameState['zoneEffects'][number]> = {}) => ({
    effect: 't_riderEffect', zoneId: 1, side: 'a' as const,
    cardName: 'Test Rider', setOnTurn: 2, ...over,
  })

  it('a permanent rider (no expiresOnTurn) survives both sides ending their turns', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.zoneEffects = [rider()]
    const first = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!first.ok) throw new Error(first.error)
    const second = applyAction(first.game, 'bob', { type: 'END_TURN' }, makeCtx())
    if (!second.ok) throw new Error(second.error)
    expect(second.game.state.zoneEffects).toHaveLength(1)
  })

  it('a rest-of-turn rider is removed at its OWN side\u2019s END_TURN', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.zoneEffects = [rider({ expiresOnTurn: 2 })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toEqual([])
  })

  it('the opponent ending their turn does not expire it', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    // b's rider, set on b's own turn 1.5; alice is the one ending turn 2.
    g.state.zoneEffects = [rider({ side: 'b', setOnTurn: 1.5, expiresOnTurn: 1.5 })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toHaveLength(1)
  })

  it('data.drawOnExpiry draws exactly one card for the ending side and logs it', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.a.deck = [inst(), inst()]
    g.state.counts.a.deck = 2
    g.state.zoneEffects = [rider({ expiresOnTurn: 2, data: { drawOnExpiry: true } })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(1)
    expect(r.game.state.counts.a).toEqual({ hand: 1, deck: 1 })
    expect(r.game.state.log.some((l) => l.includes('Test Rider') && l.includes('unused'))).toBe(true)
  })

  it('a rider without drawOnExpiry draws nothing', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.a.deck = [inst(), inst()]
    g.state.counts.a.deck = 2
    g.state.zoneEffects = [rider({ expiresOnTurn: 2 })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
  })

  it('leaves changeOrderDraw to the incoming-side loop that owns it', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    // Due NOW for the ending side by number — the new pass must still not
    // touch it, because it switches on type.
    g.state.scheduled = [{ type: 'changeOrderDraw', side: 'a', dueTurn: 2 }]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.scheduled).toEqual([{ type: 'changeOrderDraw', side: 'a', dueTurn: 2 }])
  })

  it('a sabotageWatch draws when its hull is still on the board, and is dropped', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const target = zoneEntry({ name: 'Doomed', keywords: ['fragile'] })
    g.state.zones[0].cards.b.push(target)
    g.privates.a.deck = [inst(), inst()]
    g.state.counts.a.deck = 2
    g.state.scheduled = [
      { type: 'sabotageWatch', side: 'a', dueTurn: 2, instanceId: target.instanceId },
    ]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(1)
    expect(r.game.state.scheduled).toEqual([])
  })

  it('a sabotageWatch belonging to the OTHER side is carried forward, not resolved', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const target = zoneEntry({ name: 'Doomed' })
    g.state.zones[0].cards.a.push(target)
    g.privates.b.deck = [inst(), inst()]
    g.state.counts.b.deck = 2
    const watch = {
      type: 'sabotageWatch' as const, side: 'b' as const, dueTurn: 2, instanceId: target.instanceId,
    }
    g.state.scheduled = [watch]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.scheduled).toEqual([watch])
    // b drew exactly one card — its ordinary turn draw, not a second from the watch.
    expect(r.game.privates.b.hand).toHaveLength(1)
  })

  it('a sabotageWatch that is not yet due is carried forward', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    const target = zoneEntry({ name: 'Doomed' })
    g.state.zones[0].cards.b.push(target)
    g.privates.a.deck = [inst(), inst()]
    g.state.counts.a.deck = 2
    const watch = {
      type: 'sabotageWatch' as const, side: 'a' as const, dueTurn: 4, instanceId: target.instanceId,
    }
    g.state.scheduled = [watch]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.scheduled).toEqual([watch])
    expect(r.game.privates.a.hand).toHaveLength(0)
  })

  it('a rider whose expiresOnTurn is still ahead survives', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.a.deck = [inst(), inst()]
    g.state.counts.a.deck = 2
    g.state.zoneEffects = [rider({ expiresOnTurn: 4, data: { drawOnExpiry: true } })]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zoneEffects).toHaveLength(1)
    expect(r.game.privates.a.hand).toHaveLength(0)
  })

  it('a sabotageWatch whose hull has gone draws nothing, and is still dropped', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.privates.a.deck = [inst(), inst()]
    g.state.counts.a.deck = 2
    g.state.scheduled = [
      { type: 'sabotageWatch', side: 'a', dueTurn: 2, instanceId: 'gone-in-battle' },
    ]
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.privates.a.hand).toHaveLength(0)
    expect(r.game.state.scheduled).toEqual([])
  })
})

// Wave 6 — the first half of the normalizeState pair for the loss record (the
// second is buildInitialGame, pinned in gameInit.test.ts). Every game row
// written before wave 6 has zones with no such field at all.
describe('normalizeState — lostBattleOnTurn', () => {
  it('defaults it on every zone of a pre-wave-6 row', () => {
    const g = makeGame()
    for (const zone of g.state.zones) {
      delete (zone as unknown as Record<string, unknown>).lostBattleOnTurn
    }
    normalizeState(g.state)
    for (const zone of g.state.zones) {
      expect(zone.lostBattleOnTurn).toEqual({ a: null, b: null })
    }
  })

  it('repairs a half-written record rather than replacing a real one', () => {
    const g = makeGame()
    ;(g.state.zones[0] as unknown as Record<string, unknown>).lostBattleOnTurn = { a: 2 }
    g.state.zones[1].lostBattleOnTurn = { a: null, b: 3 }
    normalizeState(g.state)
    expect(g.state.zones[0].lostBattleOnTurn).toEqual({ a: 2, b: null })
    expect(g.state.zones[1].lostBattleOnTurn).toEqual({ a: null, b: 3 })
  })
})

// A captured copy is a phantom: it never came out of anyone's deck, so it has
// no home to go to. discardCard destroys it outright, the same shape as the
// summonOnly guard — both exist to keep a card out of a deck's back door.
describe('discardCard destroys captured copies (copy model)', () => {
  it('files a captured copy into NEITHER discard pile', () => {
    const g = makeGame()
    g.privates.b.deck.push(inst({ name: 'Loot', type: 'vehicle', materialCost: 200_000 }))
    takeFromEnemyDeck(g, 'a', makeCtx())
    discardCard(g, 'a', g.privates.a.hand[0])
    expect(g.state.destroyed.a).toHaveLength(0)
    expect(g.state.destroyed.b).toHaveLength(0)
  })

  it('a captured copy dying on the board vanishes; the original stays in the enemy deck', () => {
    const g = makeGame()
    g.privates.b.deck.push(
      inst({ name: 'Loot', type: 'vehicle', keywords: ['temporary'], materialCost: 200_000 }),
      inst({ name: 'Bob Draws This Instead' }),
    )
    g.state.counts.b.deck = 2
    takeFromEnemyDeck(g, 'a', makeCtx())
    g.state.zones[0].cards.a.push(zoneEntry({ ...g.privates.a.hand[0], playedOnTurn: 2 }))
    g.privates.a.hand = []
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.destroyed.a.map((c) => c.name)).not.toContain('Loot')
    expect(r.game.state.destroyed.b.map((c) => c.name)).not.toContain('Loot')
    expect(r.game.state.zones[0].cards.a).toHaveLength(0)
    // the original is still Bob's to draw
    expect(r.game.privates.b.deck.concat(r.game.privates.b.hand).map((c) => c.name))
      .toContain('Loot')
  })

  it('an ordinary card is unaffected — it still reaches its own discard', () => {
    const g = makeGame()
    discardCard(g, 'a', inst({ name: 'Mine' }))
    expect(g.state.destroyed.a.map((c) => c.name)).toEqual(['Mine'])
    expect(g.state.destroyed.b).toHaveLength(0)
  })
})

describe('copyMeta strips capturedCopy', () => {
  it('a hull minted off a captured copy is a real card for its minter', () => {
    expect(copyMeta({ capturedCopy: true, additionalSpawns: 1 }))
      .toEqual({ additionalSpawns: 1 })
  })
})


// ---------------------------------------------------------------------------
// Wave 7 — UPKEEP_REQUIRED (spec §7.3, rulings U-0 … U-8).
//
// "At turn start, reduce your resources this turn by 15% of this card's cost."
// Driven through applyAction rather than by calling endTurn, because the whole
// ruling is about WHERE in that sequence the deduction sits: after the
// Temporary cull, after income is SET, before the draw.
//
// makeGame defaults to turnNumber 2 / activePlayer alice, so alice ending her
// turn makes turnNumber 2.5 and hands bob an income of floor(2.5) * 75k =
// 150,000. Every figure below is against that.
//
// A battle summon never pays, which has no test here because it is unreachable
// by construction rather than guarded: a summon lives only in
// ActiveBattle.summons, and applyAction refuses END_TURN outright while a
// battle stands (battleFrozen). The upkeep pass reads zone.cards, which a
// summon never enters (spec §4.4).
describe('END_TURN upkeep (wave 7)', () => {
  const TURN_INCOME = 150000
  const upkeepHull = (over: Partial<ZoneCardEntry> = {}) =>
    zoneEntry({ materialCost: 70000, keywords: [KEYWORDS.UPKEEP_REQUIRED], ...over })

  it('U-0: charges 15% of the hull cost against the turn income that was just set', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(upkeepHull())
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME - 10500)
  })

  it('U-4: charges every zone, and only the side whose turn is starting', () => {
    const g = makeGame()
    for (const zone of g.state.zones) zone.cards.b.push(upkeepHull())
    // Alice's own upkeep hull is NOT charged — it is not her turn starting.
    g.state.zones[0].cards.a.push(upkeepHull({ materialCost: 800000 }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME - 31500)
  })

  it('U-4: a captured copy is fed by whoever controls it', () => {
    const g = makeGame()
    // The capture stamp decides what happens when the hull LEAVES play, never
    // who feeds it while it is on the board.
    g.state.zones[0].cards.b.push(upkeepHull({ meta: { capturedCopy: true } }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME - 10500)
  })

  it('U-4: a vehicle without the keyword costs nothing', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(zoneEntry({ materialCost: 800000 }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME)
  })

  // The ONLY assertion that separates the two candidate cost authorities. No
  // seeded card carries both keywords, so nothing built from real data can
  // tell effectiveMaterialCostOf from printed materialCost — hence a fixture.
  it('U-1: reads effectiveMaterialCostOf, so Half-Cost halves the upkeep too', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(upkeepHull({
      materialCost: 200000, keywords: [KEYWORDS.UPKEEP_REQUIRED, KEYWORDS.HALF_COST],
    }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    // 15% of the HALVED 100,000, not of the printed 200,000.
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME - 15000)
  })

  // Every real card's 15% is exact to the hundred, so this needs a fixture too.
  it('U-2: rounds up, matching repairCostOf', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(upkeepHull({ materialCost: 70001 }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME - 10501)
  })

  // canAffordInGame compares `materials >= cost`, so a negative would behave
  // plausibly and silently. Chosen rather than defaulted.
  it('U-3: clamps at zero rather than carrying a debt', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(upkeepHull({ materialCost: 4000000 }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.resources.b.materials).toBe(0)
  })

  it('U-5: a hull pays nothing until its own side’s next turn starts', () => {
    const g = makeGame({ turnNumber: 2, activePlayer: 'alice' })
    g.state.zones[0].cards.a.push(upkeepHull({ playedOnTurn: 2 }))
    // Alice ends turn 2: bob's turn starts, and bob owns no upkeep hull.
    const first = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!first.ok) throw new Error(first.error)
    expect(first.game.state.resources.b.materials).toBe(TURN_INCOME)
    // Bob ends turn 2.5: alice's turn starts, and NOW she pays.
    const second = applyAction(first.game, 'bob', { type: 'END_TURN' }, makeCtx())
    if (!second.ok) throw new Error(second.error)
    expect(second.game.state.resources.a.materials).toBe(225000 - 10500) // floor(3) * 75k
  })

  // The Temporary cull already runs BEFORE the income line, so a despawned
  // hull cannot be billed. No TG card carries both keywords; the ordering is
  // free and it is the honest one, so it is pinned rather than left to luck.
  it('U-6: a Temporary hull despawns first and is never billed', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(upkeepHull({
      materialCost: 800000, keywords: [KEYWORDS.UPKEEP_REQUIRED, KEYWORDS.TEMPORARY],
    }))
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.zones[0].cards.b).toHaveLength(0)
    expect(r.game.state.resources.b.materials).toBe(TURN_INCOME)
  })

  it('U-7: logs one line per turn carrying the total, never one per hull', () => {
    const g = makeGame()
    for (const zone of g.state.zones) zone.cards.b.push(upkeepHull())
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    const lines = r.game.state.log.filter((l) => l.toLowerCase().includes('upkeep'))
    expect(lines).toHaveLength(1)
    // Raw, ungrouped digits, matching every other figure in state.log
    // ("base bombardment for 240"). toLocaleString would read better and is
    // locale-dependent between Node and Deno, which is not a trade this line
    // is worth making.
    expect(lines[0]).toContain('31500')
  })

  it('U-7: logs nothing at all when the side owes no upkeep', () => {
    const g = makeGame()
    const r = applyAction(g, 'alice', { type: 'END_TURN' }, makeCtx())
    if (!r.ok) throw new Error(r.error)
    expect(r.game.state.log.some((l) => l.toLowerCase().includes('upkeep'))).toBe(false)
  })
})
