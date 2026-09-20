import { describe, expect, it } from 'vitest'
import { applyAction } from '../../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../../engine/testFixtures'
import { basicPolicy } from '../basicPolicy'
import { runBotUntilIdle } from '../botDriver'
import { viewFor } from '../botView'
import { LlmHttpError, LlmTimeoutError } from './llmClient'
import type { LlmClient, LlmRequest } from './llmClient'
import { buildMenu } from './moveMenu'
import { isSectionMarker, SECTION_MARKERS } from './sections'
import { SectionedLlmPolicy } from './sectionedPolicy'

const BOT = 'bob'
const fast = { callTimeoutMs: 20, requestBudgetMs: 1000, maxCalls: 16 }
// turnGame()'s 40k Corsair play scores far above every other move on the
// board (2026-09-19 scored menu spec §3.5's zone-spread term dominates), so
// any test written before the tempo guard existed — one whose script passes
// on or plays around that opportunity for reasons unrelated to the guard —
// needs the guard switched off to keep exercising what it actually tests.
// The guard itself is exercised with `fast` (margin on) by the tests below
// that are about it.
const noGuard = { ...fast, tempoGuardTurns: Infinity }
const userOf = (req: LlmRequest): string => req.messages[req.messages.length - 1].content

// A menu number by predicate against the menu the LAST user message showed.
function idOf(user: string, want: string): number {
  const menu = user.slice(user.lastIndexOf('\nMENU\n'))
  const line = menu.split('\n').find((l) => /^#\d+ /.test(l) && l.includes(want))
  if (!line) throw new Error(`no menu line matching "${want}" in:\n${menu}`)
  return Number(line.slice(1).split(' ')[0])
}

// One entry per expected call: what to pick (null = []), then, talk; or raw
// text / an error / 'hang'. Running out of entries fails the test — call
// counts are part of every assertion.
type Step = { pick: string | string[] | null; then?: 'continue' | 'next'; talk?: string | null } | string | Error | 'hang'
function scripted(steps: Step[]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = []
  return {
    model: 'fake/model', calls,
    async complete(req, signal) {
      calls.push(req)
      const step = steps[calls.length - 1]
      if (step === undefined) throw new Error(`unexpected call #${calls.length}:\n${userOf(req)}`)
      if (step === 'hang') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new LlmTimeoutError())))
      if (step instanceof Error) throw step
      const usage = { promptTokens: 100, completionTokens: 10, cachedTokens: 50, costUsd: 0.00001 }
      if (typeof step === 'string') return { text: step, usage, latencyMs: 1 }
      const picks = step.pick === null ? [] : Array.isArray(step.pick) ? step.pick : [step.pick]
      const text = JSON.stringify({ actions: picks.map((p) => idOf(userOf(req), p)), then: step.then ?? 'continue', note: 'test', battle: null, tableTalk: step.talk ?? null })
      return { text, usage, latencyMs: 1 }
    },
  }
}

// The bot holds a 40k Corsair and has a Marauder in zone 1 from an earlier
// turn, so deploy (the play) and fight (the base attack) are non-empty and
// activate is empty.
function turnGame() {
  const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'ship-40', name: 'Corsair', materialCost: 40000 })], deck: [] } } })
  g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', name: 'Marauder', materialCost: 150000, playedOnTurn: 1 }))
  return g
}

describe('SectionedLlmPolicy — a turn', () => {
  it('walks deploy → fight → finish, skipping the empty activate, one marker and checkpoint per visited section', async () => {
    const client = scripted([
      { pick: 'PLAY Corsair', then: 'next', talk: 'Corsair, forward!' },
      { pick: 'ATTACK the enemy base in zone 1', then: 'next' },
      { pick: null },
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const markers: string[] = []
    const { game, applied, talk } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy, async (g) => { markers.push(g.state.log[g.state.log.length - 1]) })
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'ATTACK_ENEMY_BASE', 'END_TURN'])
    expect(client.calls.length).toBe(3)
    expect(markers).toEqual([SECTION_MARKERS.deploy, SECTION_MARKERS.fight, SECTION_MARKERS.finish])
    expect(game.state.log.filter(isSectionMarker)).toEqual(markers)
    expect(talk).toEqual(['Corsair, forward!'])
    expect(policy.rows.map((r) => r.section)).toEqual(['deploy', 'fight', 'finish'])
    expect(policy.rows.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(policy.rows.map((r) => r.fallbackReason)).toEqual([null, null, null])
    expect(policy.rows[0].applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE'])
    expect(policy.rows[2].plan).toEqual([])
    // The first call carries the whole situation and the deploy section only.
    const first = userOf(client.calls[0])
    expect(client.calls[0].messages[0].role).toBe('system')
    expect(client.calls[0].messages[0].content).toContain('four sections')
    expect(client.calls[0].schemaName).toBe('answer')
    expect(first).toContain('BOARD')
    expect(first).toContain('SECTION: DEPLOY')
    expect(first).not.toContain('ATTACK the enemy base')
    // The second call is a follow-up in the same history: outcome, board (a
    // section start), the fight section, and no plays on its menu.
    expect(client.calls[1].messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    const second = userOf(client.calls[1])
    expect(second).toContain('OUTCOME: ')
    expect(second).toContain('your hulls 1→2 (+Corsair)')
    expect(second).toContain('BOARD')
    expect(second).toContain('SECTION: FIGHT')
    expect(second).not.toContain('PLAY Corsair')
    expect(userOf(client.calls[2])).toContain('SECTION: FINISH')
  })

  it('re-asks in the same section on continue, with the real outcome and no board, then the hand when it changed', async () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 's1', name: 'Alpha', materialCost: 40000 }), inst({ instanceId: 's2', name: 'Bravo', materialCost: 40000 })], deck: [] } } })
    const client = scripted([
      { pick: 'PLAY Alpha', then: 'continue' },
      { pick: 'PLAY Bravo', then: 'next' },
      { pick: null },
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const { applied } = await runBotUntilIdle(g, BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(client.calls.length).toBe(3)
    const second = userOf(client.calls[1])
    expect(second).toContain('OUTCOME: materials 100k→60k')
    expect(second).toContain('YOUR HAND')          // the hand shrank
    expect(second).not.toContain('BOARD')          // same section
    expect(second).toContain('SECTION: DEPLOY')
    expect(second).not.toContain('PLAY Alpha')     // gone: it was played
    expect(userOf(client.calls[2])).toContain('BOARD')   // finish is a section start
  })

  it('moves on inside one candidates call after a pass, announcing the next section first', async () => {
    const client = scripted([{ pick: null }, { pick: null }, { pick: null }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const markers: string[] = []
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy, async (g) => { markers.push(g.state.log[g.state.log.length - 1]) })
    expect(applied.map((a) => a.type)).toEqual(['END_TURN'])
    expect(client.calls.length).toBe(3)
    expect(markers).toEqual([SECTION_MARKERS.deploy, SECTION_MARKERS.fight, SECTION_MARKERS.finish])
    expect(userOf(client.calls[1])).toContain('OUTCOME: You chose nothing in DEPLOY.')
    expect(userOf(client.calls[2])).toContain('OUTCOME: You chose nothing in FIGHT.')
    expect(policy.rows.map((r) => r.section)).toEqual(['deploy', 'fight', 'finish'])
  })

  it('speaks the line a pass carried on the next accepted move — the newest one when several passed', async () => {
    const client = scripted([
      { pick: 'PLAY Corsair', then: 'next', talk: 'Corsair, forward!' },
      { pick: null, talk: 'Nothing to fight today.' },
      { pick: null, talk: 'That will do for this turn.' },
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const { applied, talk, game } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(talk).toEqual(['Corsair, forward!', 'That will do for this turn.'])   // the fight pass's line lost to the newer finish line
    expect(game.state.log.filter((l) => l.startsWith('PracticeAI: "'))).toHaveLength(2)
    expect(policy.rows.map((r) => r.tableTalk)).toEqual(['Corsair, forward!', 'Nothing to fight today.', 'That will do for this turn.'])
  })
})

describe('SectionedLlmPolicy — finish, caps and interrupts', () => {
  // An ability card: REVEAL it as the alert card is a deploy move the engine
  // accepts again and again (the driver-cap test's loop), so it exercises
  // finish's deploy items and the per-section cap without a big fixture.
  const alertGame = () => makeGame({
    activePlayer: BOT, turnNumber: 3,
    privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 'alert-1', name: 'Smoke', type: 'ability', vehicleType: null, materialCost: 900000 })], deck: [] } },
  })

  it('a move with then:next in finish ends the turn with no further call', async () => {
    const client = scripted([{ pick: null }, { pick: 'REVEAL Smoke', then: 'next' }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(alertGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['SET_ALERT_CARD', 'END_TURN'])
    expect(client.calls.length).toBe(2)
    expect(policy.rows.map((r) => r.section)).toEqual(['deploy', 'finish'])
  })

  it('advances a section at SECTION_MAX_ACTIONS without a call', async () => {
    const steps: Step[] = Array.from({ length: 8 }, () => ({ pick: 'REVEAL Smoke', then: 'continue' as const }))
    const client = scripted([...steps, { pick: null }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(alertGame(), BOT, makeCtx(), policy)
    expect(applied.filter((a) => a.type === 'SET_ALERT_CARD')).toHaveLength(8)
    expect(applied.at(-1)?.type).toBe('END_TURN')
    expect(client.calls.length).toBe(9)
    expect(policy.rows[8].section).toBe('finish')
  })

  it('answers a choice raised mid-section as one exchange, then honours the move’s then', async () => {
    // Driven by hand: the fixture cannot raise a pendingEffect from a play,
    // so the views are built for each step the driver would take. After the
    // choice, the pending "next" leaves deploy; activate is empty; fight is
    // asked (Marauder can strike the base) and passed; finish is asked and
    // passed → END TURN. Four calls, three markers.
    const g = turnGame()
    const ctx = makeCtx()
    const client = scripted([
      { pick: 'PLAY Corsair', then: 'next' },
      { pick: 'CHOOSE "Right"' },
      { pick: null },   // fight
      { pick: null },   // finish → END TURN
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const checkpoints: string[] = []
    const hooks = { checkpoint: async (m: string) => { checkpoints.push(m) } }
    const play = (await policy.candidates(viewFor(g, 'b', ctx.rng, buildMenu(g, BOT, ctx, 'turn')), 'turn', hooks))[0]
    const played = applyAction(g, BOT, play, ctx)
    if (!played.ok) throw new Error(played.error)
    policy.onAccepted(play, 'turn', 'zone 1: your hulls 1→2 (+Corsair)')
    const c = played.game
    c.state.pendingEffect = { effect: 'e', side: 'b', card: inst({ name: 'Corsair' }), kind: 'choice', prompt: 'Pick', options: [{ id: 'x', label: 'Left' }, { id: 'y', label: 'Right' }] }
    const choice = (await policy.candidates(viewFor(c, 'b', ctx.rng, buildMenu(c, BOT, ctx, 'choice')), 'choice', hooks))[0]
    expect(choice).toEqual({ type: 'RESOLVE_PENDING_EFFECT', choiceId: 'y' })
    expect(userOf(client.calls[1])).toContain('CHOICE from Corsair: Pick')
    expect(userOf(client.calls[1])).toContain('OUTCOME: zone 1: your hulls 1→2 (+Corsair)')
    expect(userOf(client.calls[1])).not.toContain('SECTION:')
    policy.onAccepted(choice, 'choice', 'chose Right')
    c.state.pendingEffect = null
    const next = await policy.candidates(viewFor(c, 'b', ctx.rng, buildMenu(c, BOT, ctx, 'turn')), 'turn', hooks)
    expect(next[0].type).toBe('END_TURN')
    expect(client.calls.length).toBe(4)
    expect(userOf(client.calls[2])).toContain('OUTCOME: chose Right')
    expect(userOf(client.calls[2])).toContain('SECTION: FIGHT')   // the pending "next" left deploy behind
    expect(checkpoints).toEqual([SECTION_MARKERS.deploy, SECTION_MARKERS.fight, SECTION_MARKERS.finish])
    expect(policy.rows.map((r) => [r.kind, r.section])).toEqual([['turn', 'deploy'], ['choice', null], ['turn', 'fight'], ['turn', 'finish']])
  })

  it('a choice the model passes on still honours the raising move’s then', async () => {
    // As above, but the model answers [] to the choice: the heuristic picks
    // an option, and the pending "next" from the deploy move must survive —
    // the next turn call is FIGHT, not deploy again (spec §3.2 step 4).
    const g = turnGame()
    const ctx = makeCtx()
    const client = scripted([
      { pick: 'PLAY Corsair', then: 'next' },
      { pick: null },   // the choice: passed
      { pick: null },   // fight
      { pick: null },   // finish → END TURN
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const checkpoints: string[] = []
    const hooks = { checkpoint: async (m: string) => { checkpoints.push(m) } }
    const play = (await policy.candidates(viewFor(g, 'b', ctx.rng, buildMenu(g, BOT, ctx, 'turn')), 'turn', hooks))[0]
    const played = applyAction(g, BOT, play, ctx)
    if (!played.ok) throw new Error(played.error)
    policy.onAccepted(play, 'turn', 'zone 1: your hulls 1→2 (+Corsair)')
    const c = played.game
    c.state.pendingEffect = { effect: 'e', side: 'b', card: inst({ name: 'Corsair' }), kind: 'choice', prompt: 'Pick', options: [{ id: 'x', label: 'Left' }, { id: 'y', label: 'Right' }] }
    const choice = (await policy.candidates(viewFor(c, 'b', ctx.rng, buildMenu(c, BOT, ctx, 'choice')), 'choice', hooks))[0]
    expect(choice.type).toBe('RESOLVE_PENDING_EFFECT')   // the heuristic's pick
    expect(policy.rows[1].fallbackReason).toBe('passed')
    policy.onAccepted(choice, 'choice', 'chose')
    c.state.pendingEffect = null
    const next = await policy.candidates(viewFor(c, 'b', ctx.rng, buildMenu(c, BOT, ctx, 'turn')), 'turn', hooks)
    expect(next[0].type).toBe('END_TURN')
    expect(client.calls.length).toBe(4)
    expect(userOf(client.calls[2])).toContain('SECTION: FIGHT')
    expect(checkpoints).toEqual([SECTION_MARKERS.deploy, SECTION_MARKERS.fight, SECTION_MARKERS.finish])
    expect(policy.rows.map((r) => [r.kind, r.section])).toEqual([['turn', 'deploy'], ['choice', null], ['turn', 'fight'], ['turn', 'finish']])
  })

  it('a turn after a decision in the same request resumes at activate, in the same conversation', async () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', name: 'Marauder', materialCost: 150000, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', name: 'Rook', materialCost: 100000 }))
    g.state.activeBattle = { zoneId: 1, aggressor: 'b', attackerIds: ['mine-1'], defenderIds: ['foe-1'], distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null }
    g.state.zones[0].lastActivatedTurn = 3
    g.state.pendingReport = { submittedBy: 'a', results: { 'mine-1': 100, 'foe-1': 100 }, repairs: [] }
    const client = scripted([{ pick: 'APPROVE the report' }, { pick: null }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const markers: string[] = []
    const { applied } = await runBotUntilIdle(g, BOT, makeCtx(), policy, async (s) => { markers.push(s.state.log[s.state.log.length - 1]) })
    expect(applied.map((a) => a.type)).toEqual(['DECIDE_BATTLE_REPORT', 'END_TURN'])
    expect(client.calls.length).toBe(2)
    expect(markers).toEqual([SECTION_MARKERS.finish])   // activate and fight empty (zone 1 is spent), never deploy
    expect(client.calls[1].messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(userOf(client.calls[1])).toContain('OUTCOME: ')
    expect(userOf(client.calls[1])).toContain('battle resolved')
    expect(policy.rows.map((r) => [r.kind, r.section, r.seq])).toEqual([['decision', null, 1], ['turn', 'finish', 2]])
    expect(policy.rows[0].report).toEqual({ results: { 'mine-1': 100, 'foe-1': 100 }, repairs: [] })
  })
})

describe('SectionedLlmPolicy — one-move kinds and failure', () => {
  const responseGame = () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000 }))
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 's-1', name: 'Ghost', keywords: ['stealthy'] }))
    g.state.awaitingResponse = { zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], targetIds: ['s-1'], stealthyIds: ['s-1'], omissibleIds: [] }
    return g
  }

  it('answers a response with one move and no marker', async () => {
    const client = scripted([{ pick: 'WITHDRAW Ghost' }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    let checkpoints = 0
    const { applied, game } = await runBotUntilIdle(responseGame(), BOT, makeCtx(), policy, async () => { checkpoints++ })
    expect(applied).toEqual([{ type: 'RESPOND_TO_ATTACK', optOutIds: ['s-1'] }])
    expect(game.state.awaitingResponse).toBeNull()
    expect(checkpoints).toBe(0)
    expect(policy.rows[0]).toMatchObject({ kind: 'response', section: null, seq: 1, fallbackReason: null })
    expect(userOf(client.calls[0])).toContain('INCOMING ATTACK in zone 1')
  })

  it('a pass on a one-move kind is answered by the heuristic, filed as passed, without tripping', async () => {
    const client = scripted([{ pick: null, talk: 'Come and get me.' }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied, talk } = await runBotUntilIdle(responseGame(), BOT, makeCtx(), policy)
    expect(applied).toEqual([{ type: 'RESPOND_TO_ATTACK', optOutIds: [] }])   // basicPolicy fights with everyone
    expect(policy.rows.map((r) => r.fallbackReason)).toEqual(['passed'])
    expect(policy.needsMenu).toBe(true)
    expect(talk).toEqual(['Come and get me.'])
  })

  it('spends no call and files no row on an empty one-move menu', async () => {
    const client = scripted([])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const view = viewFor(turnGame(), 'b', () => 0.5, [])
    expect(await policy.candidates(view, 'decision')).toEqual(basicPolicy.candidates(view, 'decision'))
    expect(client.calls.length).toBe(0)
    expect(policy.rows.length).toBe(0)
  })

  it('trips on malformed output — including an answer that names only unknown numbers — and the heuristic finishes', async () => {
    const junk = new SectionedLlmPolicy(scripted(['this is not json']), basicPolicy, 'fake/model', fast)
    const r1 = await runBotUntilIdle(turnGame(), BOT, makeCtx(), junk)
    expect(r1.applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'ATTACK_ENEMY_BASE', 'END_TURN'])   // basicPolicy's turn
    expect(junk.rows.map((r) => r.fallbackReason)).toEqual(['malformed'])
    expect(junk.needsMenu).toBe(true)   // tripped, but the scored fallback still reads the menu
    expect(junk.rows[0].error).toMatch(/^unparseable answer/)

    const ghost = new SectionedLlmPolicy(scripted([JSON.stringify({ actions: [99], then: 'next', note: 'n', battle: null, tableTalk: null })]), basicPolicy, 'fake/model', fast)
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), ghost)
    expect(ghost.rows.map((r) => r.fallbackReason)).toEqual(['malformed'])
    expect(ghost.rows[0].error).toMatch(/^unknown menu numbers: 99/)
  })

  it('files http and timeout reasons with the detail, and trips', async () => {
    const http = new SectionedLlmPolicy(scripted([new LlmHttpError(429, 'slow down')]), basicPolicy, 'fake/model', fast)
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), http)
    expect(http.rows.map((r) => r.fallbackReason)).toEqual(['http'])
    expect(http.rows[0].error).toContain('HTTP 429')
    const slow = new SectionedLlmPolicy(scripted(['hang']), basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), slow)
    expect(applied.at(-1)?.type).toBe('END_TURN')
    expect(slow.rows.map((r) => r.fallbackReason)).toEqual(['timeout'])
    expect(slow.rows[0].latencyMs).toBeGreaterThan(0)
  })

  it('trips on the call cap and on the time budget', async () => {
    const capped = new SectionedLlmPolicy(scripted([{ pick: 'PLAY Corsair', then: 'next' }, { pick: null }]), basicPolicy, 'fake/model', { ...fast, maxCalls: 1 })
    const r1 = await runBotUntilIdle(turnGame(), BOT, makeCtx(), capped)
    expect(r1.applied[0].type).toBe('PLAY_CARD_TO_ZONE')
    expect(capped.rows.map((r) => r.fallbackReason)).toEqual([null, 'budget'])
    expect(capped.rows[1].seq).toBe(2)

    let clock = 0
    const inner = scripted([{ pick: 'PLAY Corsair', then: 'next' }, { pick: null }])
    const slowClient: LlmClient = { model: inner.model, complete: async (req, signal) => { clock += 5000; return inner.complete(req, signal) } }
    const budgeted = new SectionedLlmPolicy(slowClient, basicPolicy, 'fake/model', { ...fast, requestBudgetMs: 4000 }, () => clock)
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), budgeted)
    expect(budgeted.rows.map((r) => r.fallbackReason)).toEqual([null, 'budget'])
  })

  it('files plan_rejected when the engine took something else, and re-asks in the same section', async () => {
    // The second candidates call re-asks deploy (the refusal is "continue"),
    // is answered [], then walks fight and finish on the unchanged board —
    // four calls in all before it returns END TURN.
    const g = turnGame()
    const ctx = makeCtx()
    const client = scripted([{ pick: 'PLAY Corsair', then: 'next' }, { pick: null }, { pick: null }, { pick: null }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', noGuard)
    const hooks = { checkpoint: async () => {} }
    await policy.candidates(viewFor(g, 'b', ctx.rng, buildMenu(g, BOT, ctx, 'turn')), 'turn', hooks)
    // Pretend the engine refused it and a heuristic tail candidate landed instead.
    expect(policy.onAccepted({ type: 'ATTACK_ENEMY_BASE', zoneId: 1 }, 'turn', 'enemy base 1000→940')).toBeNull()
    expect(policy.rows[0].fallbackReason).toBe('plan_rejected')
    const next = await policy.candidates(viewFor(g, 'b', ctx.rng, buildMenu(g, BOT, ctx, 'turn')), 'turn', hooks)
    expect(next[0].type).toBe('END_TURN')
    expect(client.calls.length).toBe(4)
    expect(userOf(client.calls[1])).toContain('OUTCOME: The engine refused your move; instead: enemy base 1000→940')
    expect(userOf(client.calls[1])).toContain('SECTION: DEPLOY')   // still deploy: a refusal is "continue"
  })

  it('with actionsPerAnswer 2 keeps a plan and re-verifies its head against the fresh menu', async () => {
    const two = (names: [string, string], cost: number) => makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 's1', name: names[0], materialCost: cost }), inst({ instanceId: 's2', name: names[1], materialCost: cost })], deck: [] } } })
    const fits = scripted([{ pick: ['PLAY Alpha', 'PLAY Bravo'], then: 'next' }, { pick: null }])
    const p1 = new SectionedLlmPolicy(fits, basicPolicy, 'fake/model', { ...noGuard, actionsPerAnswer: 2 })
    const r1 = await runBotUntilIdle(two(['Alpha', 'Bravo'], 40000), BOT, makeCtx(), p1)
    expect(r1.applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(fits.calls.length).toBe(2)   // both plays from one call, then finish
    expect(p1.rows[0].plan).toHaveLength(2)
    expect(p1.rows[0].applied).toHaveLength(2)

    // Two 60k ships, 100k materials: the second drops off the menu → a fresh call in deploy.
    const stale = scripted([{ pick: ['PLAY Alpha', 'PLAY Bravo'], then: 'next' }, { pick: null }, { pick: null }])
    const p2 = new SectionedLlmPolicy(stale, basicPolicy, 'fake/model', { ...noGuard, actionsPerAnswer: 2 })
    const r2 = await runBotUntilIdle(two(['Alpha', 'Bravo'], 60000), BOT, makeCtx(), p2)
    expect(r2.applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(stale.calls.length).toBe(3)
    expect(userOf(stale.calls[1])).toContain('SECTION: DEPLOY')
  })

  it('starts tripped as disabled without a client, wants a menu for the scored fallback, and files one disabled row', async () => {
    const policy = new SectionedLlmPolicy(null, basicPolicy, 'inception/mercury-2.5')
    expect(policy.needsMenu).toBe(true)
    let checkpoints = 0
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy, async () => { checkpoints++ })
    expect(applied.at(-1)?.type).toBe('END_TURN')
    expect(checkpoints).toBe(0)
    expect(policy.rows).toHaveLength(1)
    expect(policy.rows[0]).toMatchObject({ kind: 'turn', model: 'inception/mercury-2.5', fallbackReason: 'disabled', menuSize: 0, latencyMs: 0, plan: [], section: null, seq: null })
  })
})

describe('SectionedLlmPolicy — the tempo guard', () => {
  // turnGame()'s Corsair play scores far above everything else on the whole
  // menu (it claims zone 2, the only zone with no striker yet — 2026-09-19
  // scored menu spec §3.5's zone-spread term), so a pass at ANY point before
  // it is played gets guarded into playing it — regardless of which section
  // is nominally being asked. Once it is down, the zone-1 base attack
  // (Marauder, played turn 1) is the sole item left scoring a margin above a
  // pass, so the NEXT pass — still asked as DEPLOY, since a guarded move
  // proposes with then: null and the pointer does not move — is guarded into
  // it too. After both, nothing on the board clears the margin, so passing
  // from there on is genuine: empty ACTIVATE and FIGHT are skipped, FINISH
  // is asked and passed, and END TURN goes through endTurn() unguarded.
  it('plays the best move when the model passes DEPLOY with a big deploy on the table, staying in DEPLOY', async () => {
    const client = scripted([
      { pick: null, then: 'next' },                       // pass → guarded: the zone-2 Corsair play, still DEPLOY
      { pick: null, then: 'next' },                       // pass → guarded: the zone-1 base attack, still DEPLOY
      { pick: null, then: 'next' },                       // pass → nothing left clears the margin → ACTIVATE/FIGHT skipped → FINISH
      { pick: null, then: 'next' },                       // FINISH pass → END TURN
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'ATTACK_ENEMY_BASE', 'END_TURN'])
    expect(policy.rows[0].guard).toEqual(expect.objectContaining({ picked: null }))
    expect(client.calls[1].messages[client.calls[1].messages.length - 1].content).toContain('SECTION: DEPLOY')
  })

  it('plays the base attack before ending the turn on straight passes, without pinning which exact pass the guard catches', async () => {
    const client = scripted([
      { pick: null, then: 'next' },                       // DEPLOY pass → guarded: the zone-2 Corsair play
      { pick: null, then: 'next' },                       // DEPLOY pass (pointer unmoved) → guarded: the base attack
      { pick: null, then: 'next' },                       // DEPLOY pass (pointer unmoved) → on to FINISH for real
      { pick: null, then: 'next' },                       // FINISH pass → END TURN
    ])
    // Same fixture and script as the test above — the guard's whole-menu read
    // means the base attack is claimed the moment it is the best thing left,
    // which happens right after the deploy, not later at FINISH; the looser
    // assertions here hold for that trace too, without pinning it exactly.
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', fast)
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toContain('ATTACK_ENEMY_BASE')
    expect(applied[applied.length - 1].type).toBe('END_TURN')
    expect(policy.rows.some((r) => r.guard !== null)).toBe(true)
  })

  it('lets every pick stand with the guard at Infinity, and the primer then names no guard', async () => {
    const client = scripted([{ pick: null, then: 'next' }, { pick: null, then: 'next' }, { pick: null, then: 'next' }])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', { ...fast, tempoGuardTurns: Infinity })
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['END_TURN'])
    expect(policy.rows.every((r) => r.guard === null)).toBe(true)
    for (const call of client.calls) {
      expect(call.messages[0].content).toContain('tempo estimate in brackets')
      expect(call.messages[0].content).not.toContain('is not accepted')
    }
  })

  it('tells the model the margin its settings carry — the default and an override', async () => {
    const byDefault = scripted([{ pick: null, then: 'next' }, { pick: null, then: 'next' }, { pick: null, then: 'next' }, { pick: null, then: 'next' }])
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), new SectionedLlmPolicy(byDefault, basicPolicy, 'fake/model', fast))
    expect(byDefault.calls[0].messages[0].content).toContain('A move worth at least 1 turn of tempo less than the best move is not accepted — the best move is played instead.')
    const wide = scripted([{ pick: null, then: 'next' }, { pick: null, then: 'next' }, { pick: null, then: 'next' }, { pick: null, then: 'next' }])
    await runBotUntilIdle(turnGame(), BOT, makeCtx(), new SectionedLlmPolicy(wide, basicPolicy, 'fake/model', { ...fast, tempoGuardTurns: 3 }))
    expect(wide.calls[0].messages[0].content).toContain('A move worth at least 3 turns of tempo less than the best move is not accepted')
  })

  it('does not advance the section pointer when the guard replaces a re-verified plan-head item', async () => {
    // actionsPerAnswer 2: the model names the best deploy move (Corsair to
    // zone 2) and a throwaway second move (Draw) in the SAME answer, then:
    // 'next'. Draw is legal both before and after the Corsair lands, so it
    // survives as the plan head on the next candidates call — but by then
    // the zone-1 base attack is the best thing on the whole menu and clears
    // the margin over Draw's score of 0, so the guard replaces it. The
    // answer's then: 'next' belongs to the WHOLE two-move plan, not to the
    // guard's substitute — it must not leak into an early advance once the
    // (now one-move-shorter) plan reads as "drained".
    const client = scripted([
      { pick: ['PLAY Corsair (40k) to zone 2', 'HERO POWER Draw'], then: 'next' },
      { pick: null, then: 'next' },   // still DEPLOY (the pointer did not move) → nothing else clears the margin → advances for real
      { pick: null, then: 'next' },   // FINISH pass → END TURN
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', { ...fast, actionsPerAnswer: 2 })
    const { applied } = await runBotUntilIdle(turnGame(), BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'ATTACK_ENEMY_BASE', 'END_TURN'])
    expect(client.calls.length).toBe(3)   // Draw's replacement is free — it never re-asks the model
    expect(policy.rows[0].plan).toHaveLength(2)
    // The record names the ids of the menu the guard compared — the one
    // built after the Corsair landed, where Draw is renumbered — not the
    // plan's own (stale) numbering.
    const landed = applyAction(turnGame(), BOT, { type: 'PLAY_CARD_TO_ZONE', instanceId: 'ship-40', zoneId: 2 }, makeCtx())
    if (!landed.ok) throw new Error(landed.error)
    const fresh = buildMenu(landed.game, BOT, makeCtx(), 'turn')
    const drawId = fresh.find((m) => m.action.type === 'USE_HERO_POWER' && m.action.power === 'draw')!.id
    const attackId = fresh.find((m) => m.action.type === 'ATTACK_ENEMY_BASE' && m.action.zoneId === 1)!.id
    expect(drawId).not.toBe(policy.rows[0].plan[1].id)   // the fixture really renumbers Draw
    expect(policy.rows[0].guard).toEqual({ picked: drawId, taken: attackId, gap: expect.any(Number) })
    expect(policy.rows[0].applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'ATTACK_ENEMY_BASE'])
    // then: 'next' did not fire early: the next ask is still DEPLOY, not FIGHT.
    expect(userOf(client.calls[1])).toContain('SECTION: DEPLOY')
    expect(policy.rows.map((r) => r.section)).toEqual(['deploy', 'deploy', 'finish'])
  })

  it('guards a re-verified plan-head item against its CURRENT score, not the stale one it was planned with', async () => {
    // llmPolicy.test.ts's fixture: two 40k ships, both planned into zone 1
    // in one answer (actionsPerAnswer 2). Every deploy scores the same on
    // the first menu, so Alpha lands; on the fresh menu Bravo to zone 1 is
    // worth many turns less than Bravo to zone 2 — a drop only the CURRENT
    // menu's item shows, since the plan's own Bravo item still carries the
    // first menu's score.
    const two = () => makeGame({ activePlayer: BOT, turnNumber: 3, privates: { a: { hand: [], deck: [] }, b: { hand: [inst({ instanceId: 's1', name: 'Alpha', materialCost: 40000 }), inst({ instanceId: 's2', name: 'Bravo', materialCost: 40000 })], deck: [] } } })
    const landed = applyAction(two(), BOT, { type: 'PLAY_CARD_TO_ZONE', instanceId: 's1', zoneId: 1 }, makeCtx())
    if (!landed.ok) throw new Error(landed.error)
    const fresh = buildMenu(landed.game, BOT, makeCtx(), 'turn')
    const bravoTo = (zoneId: number) => fresh.find((m) => m.action.type === 'PLAY_CARD_TO_ZONE' && m.action.instanceId === 's2' && m.action.zoneId === zoneId)!
    expect(bravoTo(1).score!).toBeLessThan(bravoTo(2).score! - 1)   // the fixture's drop clears the margin
    const client = scripted([
      { pick: ['PLAY Alpha (40k) to zone 1', 'PLAY Bravo (40k) to zone 1'], then: 'next' },
      { pick: null, then: 'next' },   // still DEPLOY (a guarded head does not move the pointer) → nothing left clears the margin → advances for real
      { pick: null, then: 'next' },   // FINISH pass → END TURN
    ])
    const policy = new SectionedLlmPolicy(client, basicPolicy, 'fake/model', { ...fast, actionsPerAnswer: 2 })
    const { applied } = await runBotUntilIdle(two(), BOT, makeCtx(), policy)
    expect(applied).toEqual([
      { type: 'PLAY_CARD_TO_ZONE', instanceId: 's1', zoneId: 1 },
      { type: 'PLAY_CARD_TO_ZONE', instanceId: 's2', zoneId: 2 },   // the guard's substitute, not the plan's zone 1
      { type: 'END_TURN' },
    ])
    expect(client.calls.length).toBe(3)
    expect(policy.rows[0].guard).toEqual({ picked: bravoTo(1).id, taken: bravoTo(2).id, gap: expect.any(Number) })
    expect(policy.rows[0].guard!.gap).toBeGreaterThanOrEqual(1)
    expect(userOf(client.calls[1])).toContain('SECTION: DEPLOY')
  })
})
