import { describe, expect, it } from 'vitest'
import { applyAction } from '../../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../../engine/testFixtures'
import { basicPolicy } from '../basicPolicy'
import { runBotUntilIdle } from '../botDriver'
import { viewFor } from '../botView'
import { LlmHttpError, LlmTimeoutError } from './llmClient'
import type { LlmClient, LlmRequest } from './llmClient'
import { LlmPolicy } from './llmPolicy'
import { buildMenu, withinWindow } from './moveMenu'
import type { MenuItem } from './moveMenu'

const userOf = (req: LlmRequest): string => req.messages[req.messages.length - 1].content

// A menu number by predicate against the menu the LAST user message showed
// (sectionedPolicy.test.ts's helper, ported here for the guard tests below,
// which need to name one specific item rather than a whole plan).
function idOf(user: string, want: string): number {
  const menu = user.slice(user.indexOf('MENU'))
  const line = menu.split('\n').find((l) => /^#\d+ /.test(l) && l.includes(want))
  if (!line) throw new Error(`no menu line matching "${want}" in:\n${menu}`)
  return Number(line.slice(1).split(' ')[0])
}

// A fake that always proposes END TURN alone, resolved from whatever menu
// the request shows — the tempo guard tests plan around the model naming
// only this move so the guard (or its absence) is the only thing at play.
function endTurnOnlyClient(calls: LlmRequest[] = []): LlmClient & { calls: LlmRequest[] } {
  return {
    model: 'fake/model', calls,
    async complete(req) {
      calls.push(req)
      const id = idOf(userOf(req), 'END TURN')
      return {
        text: JSON.stringify({ plan: [id], expectation: { summary: 's', battle: null }, tableTalk: null }),
        usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 50, costUsd: 0.00001 },
        latencyMs: 1,
      }
    },
  }
}

const BOT = 'bob'

// Each entry answers one call: a JSON string, an Error to throw, or 'hang'
// (resolve never; reject on abort). The last entry repeats.
type Scripted = string | Error | 'hang'
function fakeClient(script: Scripted[], calls: LlmRequest[] = []): LlmClient & { calls: LlmRequest[] } {
  let i = 0
  return {
    model: 'fake/model', calls,
    async complete(req, signal) {
      calls.push(req)
      const a = script[Math.min(i++, script.length - 1)]
      if (a === 'hang') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new LlmTimeoutError())))
      if (a instanceof Error) throw a
      return { text: a, usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 50, costUsd: 0.00001 }, latencyMs: 1 }
    },
  }
}

// A menu answer by predicate: finds the ids of the menu the LAST call saw.
// Tests write plans as ["PLAY", "END_TURN"] and this resolves them to ids.
function answerFor(menuText: string, wants: string[], extra: Partial<{ tableTalk: string | null; battle: object | null }> = {}): string {
  const ids = wants.map((w) => {
    const line = menuText.split('\n').find((l) => /^#\d+ /.test(l) && l.includes(w))
    if (!line) throw new Error(`no menu line matching ${w} in:\n${menuText}`)
    return Number(line.slice(1).split(' ')[0])
  })
  return JSON.stringify({ plan: ids, expectation: { summary: 'test', battle: extra.battle ?? null }, tableTalk: extra.tableTalk ?? null })
}

// A client that answers with a plan computed from the menu it is shown.
function planningClient(plans: string[][], talk: (string | null)[] = []): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = []
  let i = 0
  return {
    model: 'fake/model', calls,
    async complete(req) {
      calls.push(req)
      const user = userOf(req)
      const menuText = user.slice(user.indexOf('MENU'))
      const n = Math.min(i, plans.length - 1)
      const text = answerFor(menuText, plans[n], { tableTalk: talk[i] ?? null })
      i++
      return { text, usage: { promptTokens: 100, completionTokens: 10, cachedTokens: 0, costUsd: 0 }, latencyMs: 1 }
    },
  }
}

const turnGame = () => {
  const ship = inst({ instanceId: 'ship-40', name: 'Corsair', materialCost: 40000 })
  return makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [ship], deck: [] } } })
}
const fast = { callTimeoutMs: 20, requestBudgetMs: 1000, maxCalls: 4 }

describe('LlmPolicy', () => {
  it('applies a one-call plan in order, talks once, and records one row', async () => {
    const client = planningClient([['PLAY Corsair', 'END TURN']], ['Corsair, forward!'])
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    expect(policy.needsMenu).toBe(true)
    const { applied, talk } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(client.calls.length).toBe(1)
    expect(talk).toEqual(['Corsair, forward!'])
    expect(policy.rows.length).toBe(1)
    const row = policy.rows[0]
    expect(row.kind).toBe('turn')
    expect(row.fallbackReason).toBeNull()
    expect(row.plan.length).toBe(2)
    expect(row.applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(row.tableTalk).toBe('Corsair, forward!')
    expect(row.promptTokens).toBe(100)
    expect(row.menuSize).toBeGreaterThan(0)
  })

  it('passes the reasoning effort and routing from its settings to every call, and neither when unset', async () => {
    const reasoning = planningClient([['PLAY Corsair'], ['END TURN']])
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), new LlmPolicy(reasoning, basicPolicy, 'fake/model', { ...fast, reasoningEffort: 'high', routing: { sort: 'throughput' } }))
    expect(reasoning.calls.length).toBe(2)
    expect(reasoning.calls.map((c) => c.reasoningEffort)).toEqual(['high', 'high'])
    expect(reasoning.calls.map((c) => c.routing)).toEqual([{ sort: 'throughput' }, { sort: 'throughput' }])
    const plain = planningClient([['PLAY Corsair', 'END TURN']])
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), new LlmPolicy(plain, basicPolicy, 'fake/model', fast))
    expect(plain.calls[0].reasoningEffort).toBeUndefined()
    expect(plain.calls[0].routing).toBeUndefined()
  })

  it('makes exactly one reaction call when the plan runs out before END TURN', async () => {
    const client = planningClient([['PLAY Corsair'], ['END TURN']])
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(client.calls.length).toBe(2)
    expect(userOf(client.calls[1])).toContain('SITUATION:')
    expect(userOf(client.calls[1])).toContain('Your plan so far: #')
    expect(policy.rows.length).toBe(2)
  })

  it('re-plans when a planned move drops off the menu', async () => {
    // Two 60k ships, 100k materials: the model plans both; after the first
    // the second is unaffordable and gone from the menu → reaction call.
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 's1', name: 'Alpha', materialCost: 60000 }), inst({ instanceId: 's2', name: 'Bravo', materialCost: 60000 })], deck: [] } } })
    const client = planningClient([['PLAY Alpha', 'PLAY Bravo', 'END TURN'], ['END TURN']])
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(g, BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(client.calls.length).toBe(2)
    expect(userOf(client.calls[1])).toContain('no longer available')
  })

  it('falls back to the heuristic and trips on malformed output', async () => {
    const client = fakeClient(['this is not json'])
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])   // basicPolicy played the turn
    expect(client.calls.length).toBe(1)                                                // tripped: no second call
    expect(policy.rows.map((r) => r.fallbackReason)).toEqual(['malformed'])
    expect(policy.needsMenu).toBe(true)   // tripped, but the scored fallback still reads the menu
    expect(policy.rows[0].error).toMatch(/^unparseable answer/)
  })

  it('files http and timeout reasons, with the failure detail in error', async () => {
    const http = new LlmPolicy(fakeClient([new LlmHttpError(429, 'slow down')]), basicPolicy, 'fake/model', fast)
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), http)
    expect(http.rows.map((r) => r.fallbackReason)).toEqual(['http'])
    expect(http.rows[0].error).toContain('HTTP 429')

    const slow = new LlmPolicy(fakeClient(['hang']), basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), slow)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(slow.rows.map((r) => r.fallbackReason)).toEqual(['timeout'])
    expect(slow.rows[0].latencyMs).toBeGreaterThan(0)
    expect(slow.rows[0].error).toBeTruthy()
  })

  it('spends no call and files no row on an empty menu', async () => {
    const client: LlmClient & { calls: LlmRequest[] } = {
      model: 'fake/model', calls: [],
      async complete() { throw new Error('must not be called') },
    }
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const view = viewFor(turnGame(), 'b', () => 0.5, [])
    const candidates = await policy.candidates(view, 'decision')
    expect(candidates).toEqual(basicPolicy.candidates(view, 'decision'))
    expect(client.calls.length).toBe(0)
    expect(policy.rows.length).toBe(0)
  })

  it('trips on the call cap and on the time budget', async () => {
    // Plans that never end the turn: every call is a reaction until the cap.
    const capped = new LlmPolicy(planningClient([['PLAY Corsair'], ['END TURN']]), basicPolicy, 'fake/model', { ...fast, maxCalls: 1 })
    const r1 = await runBotUntilIdle(turnGame(), BOT, makeCtx(), capped)
    expect(r1.applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(capped.rows.map((r) => r.fallbackReason)).toEqual([null, 'budget'])

    let clock = 0
    const client = planningClient([['PLAY Corsair'], ['END TURN']])
    const slowClient: LlmClient = { model: client.model, complete: async (req, signal) => { clock += 5000; return client.complete(req, signal) } }
    const budgeted = new LlmPolicy(slowClient, basicPolicy, 'fake/model', { ...fast, requestBudgetMs: 4000 }, () => clock)
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), budgeted)
    expect(budgeted.rows.map((r) => r.fallbackReason)).toEqual([null, 'budget'])
  })

  it('answers a response, a decision and a choice with one-move plans', async () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000 }))
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 's-1', name: 'Ghost', keywords: ['stealthy'] }))
    g.state.awaitingResponse = { zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], targetIds: ['s-1'], stealthyIds: ['s-1'], omissibleIds: [] }
    const policy = new LlmPolicy(planningClient([['WITHDRAW Ghost']]), basicPolicy, 'fake/model', fast)
    const { applied, game } = await runBotUntilIdle(g, BOT, makeCtx(), policy)
    expect(applied).toEqual([{ type: 'RESPOND_TO_ATTACK', optOutIds: ['s-1'] }])
    expect(game.state.awaitingResponse).toBeNull()
    expect(policy.rows[0].kind).toBe('response')

    const c = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    c.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: 'Pick', options: [{ id: 'x', label: 'Left' }, { id: 'y', label: 'Right' }] }
    const choice = new LlmPolicy(planningClient([['CHOOSE "Right"']]), basicPolicy, 'fake/model', fast)
    const r = await runBotUntilIdle(c, BOT, makeCtx(), choice)
    // The effect 'e' is not registered, so the engine drops the choice either
    // way; what matters is which candidate the policy put first.
    expect(r.applied[0]).toEqual({ type: 'RESOLVE_PENDING_EFFECT', choiceId: 'y' })
  })

  it('starts tripped as disabled without a client, wants a menu for the scored fallback, and files one disabled row', async () => {
    const policy = new LlmPolicy(null, basicPolicy, 'inception/mercury-2.5')
    expect(policy.needsMenu).toBe(true)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(policy.rows).toHaveLength(1)
    expect(policy.rows[0]).toMatchObject({ kind: 'turn', model: 'inception/mercury-2.5', fallbackReason: 'disabled', menuSize: 0, latencyMs: 0, plan: [] })
  })
})

describe('LlmPolicy — the tempo guard', () => {
  // A deploy that scores well above END TURN; the model plans END TURN only.
  const guardGame = () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-100', materialCost: 100000 })], deck: [] } } })
    g.state.resources.b.materials = 225000
    return g
  }

  it('plays the best move instead of a plan that ends the turn a margin below it, and files the guard', async () => {
    const client = endTurnOnlyClient()
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(guardGame(), BOT, makeCtx(), policy)
    expect(applied[0].type).toBe('PLAY_CARD_TO_ZONE')
    expect(policy.rows[0].guard).toEqual(expect.objectContaining({ picked: expect.any(Number), taken: expect.any(Number) }))
    expect(policy.rows[0].guard!.gap).toBeGreaterThanOrEqual(1)
    // The primer tells the model about the guard it actually runs under.
    expect(client.calls[0].messages[0].content).toContain('A move worth at least 1 turn of tempo less than the best move is not accepted')
  })

  it('tells the model the margin its settings carry, not the constant', async () => {
    const client = endTurnOnlyClient()
    await runBotUntilIdle(guardGame(), BOT, makeCtx(), new LlmPolicy(client, basicPolicy, 'fake/model', { ...fast, tempoGuardTurns: 2.5 }))
    expect(client.calls[0].messages[0].content).toContain('A move worth at least 2.5 turns of tempo less than the best move is not accepted')
  })

  it('guards a plan-head item against its CURRENT score, not the stale one it was planned with', async () => {
    // Two 40k ships, 100k materials; the model plans both deploys into zone
    // 1. On the first menu every deploy is worth the same (any empty zone
    // threatens a second base), so Alpha to zone 1 clears the guard and
    // lands. On the fresh menu Bravo to zone 1 merely halves zone 1's time,
    // while Bravo to zone 2 threatens a second base — many turns apart. The
    // plan's own Bravo item still carries the FIRST menu's score, equal to
    // the new best, so a guard reading it never fires; only the item
    // resolved from the CURRENT menu shows the drop.
    const two = () => makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 's1', name: 'Alpha', materialCost: 40000 }), inst({ instanceId: 's2', name: 'Bravo', materialCost: 40000 })], deck: [] } } })
    // The ids the guard record must carry come from the menu the driver
    // builds after Alpha lands (numbering does not depend on the rng).
    const landed = applyAction(two(), BOT, { type: 'PLAY_CARD_TO_ZONE', instanceId: 's1', zoneId: 1 }, makeCtx())
    if (!landed.ok) throw new Error(landed.error)
    const fresh = buildMenu(landed.game, BOT, makeCtx(), 'turn')
    const bravoTo = (zoneId: number): MenuItem => {
      const m = fresh.find((m) => m.action.type === 'PLAY_CARD_TO_ZONE' && m.action.instanceId === 's2' && m.action.zoneId === zoneId)
      if (!m) throw new Error(`no Bravo deploy to zone ${zoneId}`)
      return m
    }
    expect(bravoTo(1).score!).toBeLessThan(bravoTo(2).score! - 1)   // the fixture's drop clears the margin
    const client = planningClient([['PLAY Alpha (40k) to zone 1', 'PLAY Bravo (40k) to zone 1'], ['END TURN']])
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(two(), BOT, makeCtx(), policy)
    expect(applied).toEqual([
      { type: 'PLAY_CARD_TO_ZONE', instanceId: 's1', zoneId: 1 },
      { type: 'PLAY_CARD_TO_ZONE', instanceId: 's2', zoneId: 2 },   // the guard's substitute, not the plan's zone 1
      { type: 'END_TURN' },
    ])
    expect(client.calls.length).toBe(2)   // the guarded move dropped the plan; END TURN took a fresh call
    expect(policy.rows[0].guard).toEqual({ picked: bravoTo(1).id, taken: bravoTo(2).id, gap: expect.any(Number) })
    expect(policy.rows[0].guard!.gap).toBeGreaterThanOrEqual(1)
    expect(policy.rows[0].applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'PLAY_CARD_TO_ZONE'])
  })

  it('never guards with TEMPO_GUARD_TURNS at Infinity, and the primer then names no guard', async () => {
    const client = endTurnOnlyClient()
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', { ...fast, tempoGuardTurns: Infinity })
    const { applied } = await runBotUntilIdle(guardGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['END_TURN'])
    expect(policy.rows[0].guard).toBeNull()
    expect(client.calls[0].messages[0].content).toContain('tempo estimate in brackets')
    expect(client.calls[0].messages[0].content).not.toContain('is not accepted')
  })

  it('drops a plan naming a menu number the window hid, filing it malformed so the fallback plays', async () => {
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: {
        a: { hand: [], deck: [] },
        b: {
          hand: [
            inst({ instanceId: 'ship-20', name: 'Skiff', materialCost: 20000 }),
            inst({ instanceId: 'ship-100', name: 'Corsair', materialCost: 100000 }),
          ],
          deck: [],
        },
      },
    })
    g.state.resources.b.materials = 300000
    // The same menu the driver's first call will build (same fixture, a
    // fresh seeded ctx — buildMenu draws exactly one rng value, so a second,
    // independent makeCtx() reproduces it) — so the hidden item's id below
    // is a real menu number, not a guess.
    const preview = buildMenu(g, BOT, makeCtx(), 'turn')
    const weakest = preview
      .filter((m) => m.action.type === 'PLAY_CARD_TO_ZONE' && m.action.instanceId === 'ship-20')
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0]
    expect(weakest).toBeDefined()
    expect(withinWindow(preview, 0.5).some((m) => m.id === weakest.id)).toBe(false)   // confirms the fixture hides it
    const text = JSON.stringify({ plan: [weakest.id], expectation: { summary: 's', battle: null }, tableTalk: null })
    const policy = new LlmPolicy(fakeClient([text]), basicPolicy, 'fake/model', { ...fast, menuScoreWindowTurns: 0.5 })
    const { applied } = await runBotUntilIdle(g, BOT, makeCtx(), policy)
    expect(policy.rows[0].fallbackReason).toBe('malformed')
    expect(applied[applied.length - 1].type).toBe('END_TURN')   // basicPolicy fallback still plays the turn
  })
})
