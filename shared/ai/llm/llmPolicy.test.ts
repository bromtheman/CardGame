import { describe, expect, it } from 'vitest'
import { inst, makeCtx, makeGame, zoneEntry } from '../../engine/testFixtures'
import { basicPolicy } from '../basicPolicy'
import { runBotUntilIdle } from '../botDriver'
import { viewFor } from '../botView'
import { LlmHttpError, LlmTimeoutError } from './llmClient'
import type { LlmClient, LlmRequest } from './llmClient'
import { LlmPolicy } from './llmPolicy'

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
      const menuText = req.user.slice(req.user.indexOf('MENU'))
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
    expect(client.calls[1].user).toContain('SITUATION:')
    expect(client.calls[1].user).toContain('Your plan so far: #')
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
    expect(client.calls[1].user).toContain('no longer available')
  })

  it('falls back to the heuristic and trips on malformed output', async () => {
    const client = fakeClient(['this is not json'])
    const policy = new LlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])   // basicPolicy played the turn
    expect(client.calls.length).toBe(1)                                                // tripped: no second call
    expect(policy.rows.map((r) => r.fallbackReason)).toEqual(['malformed'])
    expect(policy.needsMenu).toBe(false)   // tripped: the driver must stop building a menu
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

  it('starts tripped as disabled without a client, builds no menu, and files one disabled row', async () => {
    const policy = new LlmPolicy(null, basicPolicy, 'inception/mercury-2.5')
    expect(policy.needsMenu).toBe(false)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(policy.rows).toHaveLength(1)
    expect(policy.rows[0]).toMatchObject({ kind: 'turn', model: 'inception/mercury-2.5', fallbackReason: 'disabled', menuSize: 0, latencyMs: 0, plan: [] })
  })
})
