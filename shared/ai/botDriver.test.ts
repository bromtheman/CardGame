import { describe, expect, it } from 'vitest'
import type { GameAction } from '../engine/engineTypes'
import { applyAction } from '../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures'
import { basicPolicy } from './basicPolicy'
import type { BotPolicy, OwedKind } from './basicPolicy'
import type { BotView } from './botView'
import { BOT_ACTION_CAP, FALLBACK, botOwes, runBotUntilIdle } from './botDriver'
import { LOG_MAX_ENTRIES } from '../gameSettings'
import { formatTableTalk, isTableTalk } from './llm/tableTalk'

// The bot is bob / side 'b' throughout, as in every practice game.
const BOT = 'bob'

function stuckPolicy(): BotPolicy {
  // Only ever proposes an action the engine refuses.
  return { candidates: () => [{ type: 'PLAY_CARD_TO_ZONE', instanceId: 'ghost', zoneId: 1 }] }
}

describe('botOwes', () => {
  it('reads the freeze order the engine applies: choice, response, decision, battle, turn', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    expect(botOwes(g, 'b')).toBe('turn')
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'b', attackerIds: ['m'], defenderIds: ['f'],
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    expect(botOwes(g, 'b')).toBeNull()                       // the human fights and reports
    g.state.pendingReport = { submittedBy: 'a', results: {}, repairs: [] }
    expect(botOwes(g, 'b')).toBe('decision')
    g.state.pendingReport = { submittedBy: 'b', results: {}, repairs: [] }
    expect(botOwes(g, 'b')).toBeNull()                       // unreachable in practice; never self-approve
    g.state.pendingReport = null
    g.state.activeBattle = null
    g.state.awaitingResponse = { zoneId: 1, aggressor: 'a', attackerIds: [], targetIds: [], stealthyIds: [], omissibleIds: [] }
    expect(botOwes(g, 'b')).toBe('response')
    g.state.awaitingResponse.aggressor = 'b'
    expect(botOwes(g, 'b')).toBeNull()                       // the human decides opt-outs
    g.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: '', options: [{ id: 'o', label: 'O' }] }
    expect(botOwes(g, 'b')).toBe('choice')                   // ahead of the battle window
    g.state.pendingEffect.side = 'a'
    expect(botOwes(g, 'b')).toBeNull()
  })
  it('owes nothing on the human’s turn or once the game is over', () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    expect(botOwes(g, 'b')).toBeNull()
    const over = makeGame({ activePlayer: BOT, status: 'complete', winnerId: 'alice' })
    expect(botOwes(over, 'b')).toBeNull()
  })
})

describe('runBotUntilIdle', () => {
  it('plays a turn — deploys what it can afford and hands the turn over', async () => {
    const ship = inst({ instanceId: 'ship-40', materialCost: 40000 })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [ship], deck: [] } },
    })
    const { game, applied } = await runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(game.activePlayer).toBe('alice')
    expect(game.state.zones.flatMap((z) => z.cards.b).map((c) => c.instanceId)).toEqual(['ship-40'])
    expect(g.activePlayer).toBe(BOT)            // input untouched
  })

  it('stops at a battle it declares, and finishes the turn once the human has reported', async () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000, keywords: ['blocker'] }))
    const first = await runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(first.applied.map((a) => a.type)).toEqual(['ATTACK_ENEMY_FLEET'])   // base attack refused by the Blocker
    expect(first.game.state.activeBattle?.attackerIds).toEqual(['mine-1'])
    expect(first.game.activePlayer).toBe(BOT)
    expect(botOwes(first.game, 'b')).toBeNull()

    const reported = applyAction(first.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: { 'mine-1': 100, 'foe-1': 100 }, repairs: [],
    })
    if (!reported.ok) throw new Error(reported.error)
    const second = await runBotUntilIdle(reported.game, BOT, makeCtx(), basicPolicy)
    expect(second.applied.map((a) => a.type)).toEqual(['DECIDE_BATTLE_REPORT', 'END_TURN'])
    expect(second.game.state.activeBattle).toBeNull()
    expect(second.game.activePlayer).toBe('alice')
  })

  it('answers a choice the human’s play handed it', async () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    // An effect name the registry does not know resolves as "dropped" (ok:true)
    // — enough to prove the driver picked an option and cleared the slot.
    g.state.pendingEffect = {
      effect: 'not-a-real-effect', side: 'b', card: inst({}), kind: 'choice', prompt: '',
      options: [{ id: 'o1', label: 'One' }],
    }
    const { game, applied } = await runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(applied).toEqual([{ type: 'RESOLVE_PENDING_EFFECT', choiceId: 'o1' }])
    expect(game.state.pendingEffect).toBeNull()
  })

  it('does nothing when the human owes the next action', async () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    g.state.pendingEffect = { effect: 'e', side: 'a', card: inst({}), kind: 'choice', prompt: '', options: [] }
    const { game, applied } = await runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(applied).toEqual([])
    expect(game).toEqual(g)
  })

  it('falls back to the guaranteed action for each owed kind when the policy has only illegal ideas', async () => {
    const turn = makeGame({ activePlayer: BOT, turnNumber: 3 })
    expect((await runBotUntilIdle(turn, BOT, makeCtx(), stuckPolicy())).applied).toEqual([FALLBACK.turn])

    const response = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    response.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', playedOnTurn: 1 }))
    response.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'sneak', keywords: ['stealthy'] }))
    response.state.awaitingResponse = {
      zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], targetIds: ['sneak'], stealthyIds: ['sneak'], omissibleIds: [],
    }
    const r = await runBotUntilIdle(response, BOT, makeCtx(), stuckPolicy())
    expect(r.applied).toEqual([FALLBACK.response])
    expect(r.game.state.activeBattle?.defenderIds).toEqual(['sneak'])

    const decision = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    decision.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1' }))
    decision.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1' }))
    decision.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], defenderIds: ['mine-1'],
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    decision.state.pendingReport = { submittedBy: 'a', results: { 'foe-1': 100, 'mine-1': 100 }, repairs: [] }
    const d = await runBotUntilIdle(decision, BOT, makeCtx(), stuckPolicy())
    expect(d.applied).toEqual([FALLBACK.decision])
    expect(d.game.state.pendingReport).toBeNull()
    expect(d.game.state.activeBattle).not.toBeNull()   // a reject: the battle awaits a corrected report

    const choice = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    choice.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: '', options: [{ id: 'o', label: 'O' }] }
    const c = await runBotUntilIdle(choice, BOT, makeCtx(), stuckPolicy())
    expect(c.applied).toEqual([FALLBACK.choice])
    expect(c.game.state.pendingEffect).toBeNull()
  })

  it('rejects a report whose own repairs the human cannot afford, instead of throwing', async () => {
    // The engine re-checks BOTH sides' repair bills at approval and refuses
    // the whole approval when the submitter's own are unaffordable — so no
    // approval, the bare one included, can ever land on this report. Reject
    // is the one decision the non-submitter can always make; the human
    // resubmits. Before the fix this was a thrown "fallback was refused" and
    // a 500 for the human's own input.
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000 }))   // repair 50k
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1' }))
    g.state.activeBattle = {
      zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], defenderIds: ['mine-1'],
      distanceM: 1200, distanceModifiedBy: [], summons: [], continuation: null,
    }
    g.state.pendingReport = { submittedBy: 'a', results: { 'foe-1': 85, 'mine-1': 100 }, repairs: ['foe-1'] }
    g.state.resources.a.materials = 10000
    // A rejected promise here fails the test itself — the same guarantee the
    // old synchronous expect(() => {...}).not.toThrow() gave.
    const out = await runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(out.applied).toEqual([FALLBACK.decision])
    expect(out.game.state.pendingReport).toBeNull()
    expect(out.game.state.activeBattle).not.toBeNull()
  })

  it('caps a runaway policy and still ends the turn', async () => {
    // SET_ALERT_CARD on your own ability card is accepted again and again
    // ("your own alert may be re-revealed"), which is exactly the loop the
    // cap exists for.
    const alert = inst({ instanceId: 'alert-1', type: 'ability', vehicleType: null })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [alert], deck: [] } },
    })
    const runaway: BotPolicy = { candidates: () => [{ type: 'SET_ALERT_CARD', instanceId: 'alert-1' }] }
    const { game, applied } = await runBotUntilIdle(g, BOT, makeCtx(), runaway)
    expect(applied).toHaveLength(BOT_ACTION_CAP + 1)
    expect(applied.slice(0, BOT_ACTION_CAP).every((a: GameAction) => a.type === 'SET_ALERT_CARD')).toBe(true)
    expect(applied.at(-1)).toEqual(FALLBACK.turn)
    expect(game.activePlayer).toBe('alice')
  })

  it('refuses a player who is not in the game', async () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    await expect(runBotUntilIdle(g, 'stranger', makeCtx(), basicPolicy)).rejects.toThrow(/not in this game/)
  })
})

describe('runBotUntilIdle with a menu-reading, talking policy', () => {
  // Plays the first PLAY_CARD_TO_ZONE the menu offers, else ends the turn;
  // hands out one table-talk line per accepted planned move.
  function menuPolicy(lines: (string | null)[]): BotPolicy & { seen: number[] } {
    let planned: GameAction | null = null
    const policy = {
      needsMenu: true,
      seen: [] as number[],
      candidates(view: BotView, _kind: OwedKind): GameAction[] {
        policy.seen.push(view.menu?.length ?? -1)
        const first = view.menu?.find((m) => m.action.type === 'PLAY_CARD_TO_ZONE')
        planned = first ? first.action : { type: 'END_TURN' }
        return [planned]
      },
      onAccepted(action: GameAction): string | null {
        return planned && JSON.stringify(action) === JSON.stringify(planned) ? (lines.shift() ?? null) : null
      },
    }
    return policy
  }

  it('builds a menu per iteration, applies the plan and appends guarded table-talk after the move’s own lines', async () => {
    const ship = inst({ instanceId: 'ship-40', name: 'Corsair', materialCost: 40000 })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [ship, inst({ instanceId: 'kept', name: 'Kraken', materialCost: 900000 })], deck: [] } },
    })
    const policy = menuPolicy(['Corsair on the water!', 'I still hold my Kraken'])
    const { game, applied, talk } = await runBotUntilIdle(g, BOT, makeCtx(), policy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(policy.seen.length).toBe(2)                         // one menu per iteration
    expect(policy.seen.every((n) => n > 0)).toBe(true)
    expect(talk).toEqual(['Corsair on the water!'])           // the Kraken line named a hand card → dropped
    const log = game.state.log
    const playLine = log.findIndex((l) => l.includes('Corsair'))
    expect(log[playLine + 1]).toBe(formatTableTalk('Corsair on the water!'))
    expect(log.some((l) => l.includes('Kraken'))).toBe(false)
  })

  it('does not build a menu for a policy that does not ask, and writes no talk for it', async () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    const { game, talk } = await runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(talk).toEqual([])
    expect(game.state.log.some((l) => isTableTalk(l))).toBe(false)
  })

  it('keeps the log under the cap when it appends', async () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.log = Array.from({ length: LOG_MAX_ENTRIES }, (_, i) => `old ${i}`)
    const { game } = await runBotUntilIdle(g, BOT, makeCtx(), menuPolicy(['Nothing to do but wait.']))
    expect(game.state.log.length).toBeLessThanOrEqual(LOG_MAX_ENTRIES)
    expect(game.state.log[game.state.log.length - 1]).toBe(formatTableTalk('Nothing to do but wait.'))
  })
})
