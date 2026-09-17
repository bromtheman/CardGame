import { describe, expect, it } from 'vitest'
import type { GameAction } from '../../engine/engineTypes'
import { applyAction, knownActionTypes } from '../../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../../engine/testFixtures'
import { FALLBACK } from '../botDriver'
import { MENU_MAX_ITEMS, MENU_MAX_TRIALS } from './llmSettings'
import { buildMenu, MENU_ACTION_TYPES, MENU_EXCLUDED_TYPES, sameAction } from './moveMenu'

const BOT = 'bob'   // side 'b', as in every practice game

describe('buildMenu', () => {
  it('offers only moves the engine accepts, numbered from 1', () => {
    const cheap = inst({ instanceId: 'ship-40', materialCost: 40000 })
    const dear = inst({ instanceId: 'ship-900', materialCost: 900000 })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [cheap, dear], deck: [] } },
    })
    const menu = buildMenu(g, BOT, makeCtx(), 'turn')
    expect(menu.map((m) => m.id)).toEqual(menu.map((_, i) => i + 1))
    for (const item of menu) expect(applyAction(g, BOT, item.action, makeCtx()).ok, item.text).toBe(true)
    // The 40k ship goes to the water and beach zones — a ship takes both
    // (shared/engine/placement.ts's BIOMES_BY_TYPE, confirmed by the next
    // test's "beach takes a ship" case); the land zone refuses a ship, and
    // the 900k ship is unaffordable in either.
    const plays = menu.filter((m) => m.action.type === 'PLAY_CARD_TO_ZONE').map((m) => m.action)
    expect(plays).toEqual([
      { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-40', zoneId: 1 },
      { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-40', zoneId: 2 },
    ])
    expect(menu.some((m) => m.action.type === 'END_TURN')).toBe(true)
    expect(menu.some((m) => m.action.type === 'ATTACK_ENEMY_BASE')).toBe(false)   // no hull on the field
  })

  it('offers a base attack, a move and a hero power when the board allows them', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, keywords: ['mobile'], playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), 'turn').map((m) => m.action)
    expect(menu).toContainEqual({ type: 'ATTACK_ENEMY_BASE', zoneId: 1 })
    expect(menu).toContainEqual({ type: 'MOVE_VEHICLE', instanceId: 'mine-1', zoneId: 2 })   // beach takes a ship
    expect(menu).not.toContainEqual({ type: 'MOVE_VEHICLE', instanceId: 'mine-1', zoneId: 3 }) // land does not
    expect(menu).toContainEqual({ type: 'USE_HERO_POWER', power: 'draw' })
    // OW bot: Change Order is its faction power; DWG's Boarding Party is not offered.
    expect(menu.some((a) => a.type === 'USE_HERO_POWER' && a.power === 'boardingParty')).toBe(false)
  })

  // A throwing trial is not reachable through the public API today — Drones
  // (the one hero power the enumerator reaches that reads ctx.catalog) fails
  // gracefully with an ok:false result even when the catalog can't supply
  // its card, rather than throwing. This still pins buildMenu against the
  // scenario the try/catch guards: a catalog-dependent power enumerated and
  // trialed with an empty catalog must not break the rest of the menu.
  it('still returns a menu when a catalog-dependent hero power is trialed against an empty catalog', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.factions.b = 'TG'   // owns Drones, so it is enumerated and trialed
    const menu = buildMenu(g, BOT, makeCtx(), 'turn')   // makeCtx() defaults catalog: []
    expect(menu.some((m) => m.action.type === 'END_TURN')).toBe(true)
    expect(menu.some((m) => m.action.type === 'USE_HERO_POWER' && m.action.power === 'drones')).toBe(false)
  })

  it('enumerates responses, decisions and choices', () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    g.state.awaitingResponse = {
      zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], targetIds: ['s-1', 's-2'], stealthyIds: ['s-1', 's-2'], omissibleIds: [],
    }
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1' }))
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 's-1', keywords: ['stealthy'] }), zoneEntry({ instanceId: 's-2', keywords: ['stealthy'] }))
    const responses = buildMenu(g, BOT, makeCtx(), 'response').map((m) => m.action)
    expect(responses).toEqual([
      { type: 'RESPOND_TO_ATTACK', optOutIds: [] },
      { type: 'RESPOND_TO_ATTACK', optOutIds: ['s-1', 's-2'] },
      { type: 'RESPOND_TO_ATTACK', optOutIds: ['s-1'] },
      { type: 'RESPOND_TO_ATTACK', optOutIds: ['s-2'] },
    ])

    const c = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    c.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: 'Pick', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }
    const choices = buildMenu(c, BOT, makeCtx(), 'choice').map((m) => m.action)
    expect(choices).toEqual([
      { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'x' },
      { type: 'RESOLVE_PENDING_EFFECT', choiceId: 'y' },
      { type: 'RESOLVE_PENDING_EFFECT', cancel: true },
    ])

    const d = makeGame({ activePlayer: BOT, turnNumber: 3 })
    d.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'm-1', materialCost: 100000 }), zoneEntry({ instanceId: 'm-2', materialCost: 60000 }))
    d.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'f-1', materialCost: 50000 }))
    d.state.activeBattle = { zoneId: 1, aggressor: 'b', attackerIds: ['m-1', 'm-2'], defenderIds: ['f-1'], distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null }
    d.state.pendingReport = { submittedBy: 'a', results: { 'm-1': 85, 'm-2': 85, 'f-1': 100 }, repairs: [] }
    const decisions = buildMenu(d, BOT, makeCtx(), 'decision').map((m) => m.action)
    expect(decisions).toEqual([
      { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: [] },
      { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: ['m-1'] },
      { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: ['m-1', 'm-2'] },
      { type: 'DECIDE_BATTLE_REPORT', approve: true, repairs: ['m-2'] },
    ])
  })

  it('draws exactly one rng value however many trials it runs', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', keywords: ['mobile'] }))
    let draws = 0
    const ctx = makeCtx({ rng: () => { draws++; return 0.5 } })
    buildMenu(g, BOT, ctx, 'turn')
    expect(draws).toBe(1)
  })

  it('caps the items and always keeps the kind’s fallback action', () => {
    // Eight Mobile hulls in zone 1 → 8 moves, 8 redeploys, 8 Counter
    // Intelligence tries, attacks, END_TURN… The kept slice is the enumeration
    // head, and END_TURN is in it because it is enumerated first.
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    for (let i = 0; i < 8; i++) g.state.zones[0].cards.b.push(zoneEntry({ instanceId: `m-${i}`, keywords: ['mobile'], playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), 'turn')
    expect(menu.length).toBeLessThanOrEqual(MENU_MAX_ITEMS)
    expect(menu.length).toBeLessThanOrEqual(MENU_MAX_TRIALS)
    expect(menu.some((m) => sameAction(m.action, FALLBACK.turn))).toBe(true)
  })
})

describe('coverage pin', () => {
  it('offers every action type the engine knows except the three the bot never takes', () => {
    const offered = new Set<GameAction['type']>([...MENU_ACTION_TYPES, ...MENU_EXCLUDED_TYPES])
    expect([...offered].sort()).toEqual([...new Set(knownActionTypes())].sort())
    expect([...MENU_EXCLUDED_TYPES].sort()).toEqual(['ABANDON', 'CONCEDE', 'SUBMIT_BATTLE_REPORT'])
  })
})

describe('sameAction', () => {
  it('ignores key order and undefined keys', () => {
    expect(sameAction({ type: 'MOVE_VEHICLE', instanceId: 'x', zoneId: 1 }, { zoneId: 1, instanceId: 'x', type: 'MOVE_VEHICLE' })).toBe(true)
    expect(sameAction({ type: 'ACTIVATE_VEHICLE', instanceId: 'x', zoneId: undefined }, { type: 'ACTIVATE_VEHICLE', instanceId: 'x' })).toBe(true)
    expect(sameAction({ type: 'MOVE_VEHICLE', instanceId: 'x', zoneId: 1 }, { type: 'MOVE_VEHICLE', instanceId: 'x', zoneId: 2 })).toBe(false)
  })
})
