import { describe, expect, it, vi } from 'vitest'
import type { EngineContext, EngineGame, GameAction } from '../../engine/engineTypes'
import { applyAction, knownActionTypes } from '../../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../../engine/testFixtures'
import { FALLBACK } from '../botDriver'
import { MENU_MAX_ITEMS, MENU_MAX_TRIALS, MENU_SCORE_WINDOW_TURNS } from './llmSettings'
import { buildMenu, MENU_ACTION_TYPES, MENU_EXCLUDED_TYPES, sameAction, tempoTag, withinWindow } from './moveMenu'
import type { MenuItem } from './moveMenu'

import { sectionOf } from './sections'

// The throw is gated on one sentinel instanceId ('boom-card', created only by
// the "keeps other items scored when one item throws" test below), so every
// other test in this file still exercises the real evaluator untouched.
vi.mock('../evaluator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../evaluator')>()
  return {
    ...actual,
    scoreMove: (game: EngineGame, botId: string, action: GameAction, ctx: EngineContext, seed: number): number | null => {
      if (action.type === 'PLAY_CARD_TO_ZONE' && action.instanceId === 'boom-card') throw new Error('scoring boom (test)')
      return actual.scoreMove(game, botId, action, ctx, seed)
    },
  }
})

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

  it('offers Boarding Party against an enemy hovercraft — it counts as a ship (2026-09-22 hovercraft amendment)', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.factions = { a: 'LH', b: 'DWG' }
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine', faction: 'DWG', materialCost: 100000, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'hov', faction: 'LH', vehicleType: 'hover', materialCost: 90000, playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), 'turn').map((m) => m.action)
    expect(menu).toContainEqual({ type: 'USE_HERO_POWER', power: 'boardingParty', instanceId: 'mine', targetInstanceId: 'hov' })
  })

  it('offers an LH bot Surge once per zone, each line naming its zone (2026-09-23 amendment)', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.factions = { a: 'DWG', b: 'LH' }
    g.state.zones[1].cards.b.push(zoneEntry({ instanceId: 'cell', faction: 'LH', meta: { chargeMax: 2 }, playedOnTurn: 1 }))
    const surges = buildMenu(g, BOT, makeCtx(), 'turn')
      .filter((m) => m.action.type === 'USE_HERO_POWER' && m.action.power === 'surge')
    expect(surges.map((m) => m.action)).toEqual([
      { type: 'USE_HERO_POWER', power: 'surge', zoneId: 1 },
      { type: 'USE_HERO_POWER', power: 'surge', zoneId: 2 },
      { type: 'USE_HERO_POWER', power: 'surge', zoneId: 3 },
    ])
    expect(surges.map((m) => m.text.split(' → ')[0])).toEqual([
      'HERO POWER Surge: zone 1', 'HERO POWER Surge: zone 2', 'HERO POWER Surge: zone 3',
    ])
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

  it("tags every item with its section — END TURN is finish, one-move kinds are none", () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: "mine-1", materialCost: 150000, keywords: ["mobile"], playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), "turn")
    for (const item of menu) expect(item.section, item.text).toBe(sectionOf(item.action))
    expect(menu.find((m) => m.action.type === "END_TURN")?.section).toBe("finish")
    expect(menu.find((m) => m.action.type === "ATTACK_ENEMY_BASE")?.section).toBe("fight")
    expect(menu.find((m) => m.action.type === "MOVE_VEHICLE")?.section).toBe("deploy")

    const c = makeGame({ activePlayer: "alice", turnNumber: 3 })
    c.state.pendingEffect = { effect: "e", side: "b", card: inst({}), kind: "choice", prompt: "Pick", options: [{ id: "x", label: "X" }] }
    for (const item of buildMenu(c, BOT, makeCtx(), "choice")) expect(item.section).toBeNull()
  })

  it('never offers a fleet attack every defender could withdraw from', () => {
    // A lone Stealthy defender. The engine accepts the declaration, but the
    // human withdraws the hull at no cost, the attack is called off with the
    // zone activation unspent (design spec §3.4) and the state unchanged, and
    // the next request rebuilds this same menu — so a stateless policy
    // re-declares it forever, a withdrawal per lap for the human. The
    // heuristic has skipped it since the AI-opponent spec (§6.1); the menu,
    // which every other flow reads, has to skip it too.
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].baseHp.a = 0   // no base attack to get in the way
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 200000, playedOnTurn: 2 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'ghost', materialCost: 50000, keywords: ['stealthy'] }))
    expect(applyAction(g, BOT, { type: 'ATTACK_ENEMY_FLEET', zoneId: 1 }, makeCtx()).ok).toBe(true)   // the engine would take it
    const menu = buildMenu(g, BOT, makeCtx(), 'turn').map((m) => m.action)
    expect(menu).not.toContainEqual({ type: 'ATTACK_ENEMY_FLEET', zoneId: 1 })
    expect(menu).toContainEqual({ type: 'END_TURN' })
    // One defender that cannot slip away is enough to make the fight real.
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'plain', materialCost: 50000 }))
    expect(buildMenu(g, BOT, makeCtx(), 'turn').map((m) => m.action)).toContainEqual({ type: 'ATTACK_ENEMY_FLEET', zoneId: 1 })
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
    for (const section of ['deploy', 'activate', 'fight', 'finish', null] as const) {
      expect(menu.filter((m) => m.section === section).length, String(section)).toBeLessThanOrEqual(MENU_MAX_ITEMS)
    }
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

describe('tempo deltas', () => {
  it('scores every turn item against END TURN, which carries 0', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
    g.state.resources.b.materials = 225000
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, playedOnTurn: 1 }))
    const menu = buildMenu(g, BOT, makeCtx(), 'turn')
    const end = menu.find((m) => m.action.type === 'END_TURN')!
    expect(end.score).toBe(0)
    const deploy = menu.find((m) => m.action.type === 'PLAY_CARD_TO_ZONE')!
    const bombard = menu.find((m) => m.action.type === 'ATTACK_ENEMY_BASE')!
    expect(deploy.score).toBeGreaterThan(0)
    expect(bombard.score).toBeGreaterThan(0)
    for (const m of menu) expect(typeof m.score).toBe('number')
  })
  it('leaves the one-move kinds unscored', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: 'Pick', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }
    for (const m of buildMenu(g, BOT, makeCtx(), 'choice')) expect(m.score).toBeNull()
  })
  it('still draws exactly one rng value with scoring on', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', keywords: ['mobile'], playedOnTurn: 1 }))
    let draws = 0
    buildMenu(g, BOT, makeCtx({ rng: () => { draws++; return 0.5 } }), 'turn')
    expect(draws).toBe(1)
  })
  it('formats the tag to one decimal with a sign, and nothing for null', () => {
    expect(tempoTag(2.44)).toBe(' [+2.4]')
    expect(tempoTag(-1.26)).toBe(' [-1.3]')
    expect(tempoTag(0)).toBe(' [0.0]')
    expect(tempoTag(-0.04)).toBe(' [0.0]')
    expect(tempoTag(null)).toBe('')
  })
  // scoreMove re-runs a verified action on its own seed, so a latent
  // rng-dependent handler throw can clear the trial and then surface only
  // during scoring — the mock above forces exactly that for one card's
  // PLAY_CARD_TO_ZONE. The thrown item must keep null, same as an
  // uncompletable trial, rather than taking the rest of the menu down with it.
  it('keeps other items scored when one item throws while scoring', () => {
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'boom-card', materialCost: 40000 })], deck: [] } },
    })
    const menu = buildMenu(g, BOT, makeCtx(), 'turn')
    const thrown = menu.filter((m) => m.action.type === 'PLAY_CARD_TO_ZONE' && m.action.instanceId === 'boom-card')
    expect(thrown.length).toBeGreaterThan(0)
    for (const m of thrown) expect(m.score).toBeNull()
    const end = menu.find((m) => m.action.type === 'END_TURN')!
    expect(typeof end.score).toBe('number')
    const power = menu.find((m) => m.action.type === 'USE_HERO_POWER' && m.action.power === 'draw')!
    expect(typeof power.score).toBe('number')
  })
})

describe('withinWindow', () => {
  it('keeps items within the window of the best, unscored items, and END TURN always', () => {
    const menu: MenuItem[] = [
      { id: 1, action: { type: 'END_TURN' }, text: 'end', section: 'finish', score: 0 },
      { id: 2, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, text: 'a', section: 'fight', score: 3 },
      { id: 3, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 2 }, text: 'b', section: 'fight', score: 1.5 },
      { id: 4, action: { type: 'ATTACK_ENEMY_BASE', zoneId: 3 }, text: 'c', section: 'fight', score: null },
    ]
    expect(withinWindow(menu, 2).map((m) => m.id)).toEqual([1, 2, 3, 4])
    expect(withinWindow(menu, 1).map((m) => m.id)).toEqual([1, 2, 4])
    expect(withinWindow(menu, Infinity)).toEqual(menu)
  })
})

describe('MENU_SCORE_WINDOW_TURNS', () => {
  it('defaults to a finite window of 2 turns — the 2026-09-19 eval matrix\'s shipped variant (V3)', () => {
    expect(Number.isFinite(MENU_SCORE_WINDOW_TURNS)).toBe(true)
    expect(MENU_SCORE_WINDOW_TURNS).toBe(2)
  })
})
