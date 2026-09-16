import { describe, expect, it } from 'vitest'
import type { GameAction } from '../engine/engineTypes'
import { applyAction } from '../engine/index'
import { inst, makeCtx, makeGame, zoneEntry } from '../engine/testFixtures'
import { basicPolicy } from './basicPolicy'
import type { BotPolicy } from './basicPolicy'
import { BOT_ACTION_CAP, FALLBACK, botOwes, runBotUntilIdle } from './botDriver'

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
  it('plays a turn — deploys what it can afford and hands the turn over', () => {
    const ship = inst({ instanceId: 'ship-40', materialCost: 40000 })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [ship], deck: [] } },
    })
    const { game, applied } = runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(applied.map((a) => a.type)).toEqual(['PLAY_CARD_TO_ZONE', 'END_TURN'])
    expect(game.activePlayer).toBe('alice')
    expect(game.state.zones.flatMap((z) => z.cards.b).map((c) => c.instanceId)).toEqual(['ship-40'])
    expect(g.activePlayer).toBe(BOT)            // input untouched
  })

  it('stops at a battle it declares, and finishes the turn once the human has reported', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    g.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'mine-1', materialCost: 150000, playedOnTurn: 1 }))
    g.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', materialCost: 100000, keywords: ['blocker'] }))
    const first = runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(first.applied.map((a) => a.type)).toEqual(['ATTACK_ENEMY_FLEET'])   // base attack refused by the Blocker
    expect(first.game.state.activeBattle?.attackerIds).toEqual(['mine-1'])
    expect(first.game.activePlayer).toBe(BOT)
    expect(botOwes(first.game, 'b')).toBeNull()

    const reported = applyAction(first.game, 'alice', {
      type: 'SUBMIT_BATTLE_REPORT', results: { 'mine-1': 100, 'foe-1': 100 }, repairs: [],
    })
    if (!reported.ok) throw new Error(reported.error)
    const second = runBotUntilIdle(reported.game, BOT, makeCtx(), basicPolicy)
    expect(second.applied.map((a) => a.type)).toEqual(['DECIDE_BATTLE_REPORT', 'END_TURN'])
    expect(second.game.state.activeBattle).toBeNull()
    expect(second.game.activePlayer).toBe('alice')
  })

  it('answers a choice the human’s play handed it', () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    // An effect name the registry does not know resolves as "dropped" (ok:true)
    // — enough to prove the driver picked an option and cleared the slot.
    g.state.pendingEffect = {
      effect: 'not-a-real-effect', side: 'b', card: inst({}), kind: 'choice', prompt: '',
      options: [{ id: 'o1', label: 'One' }],
    }
    const { game, applied } = runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(applied).toEqual([{ type: 'RESOLVE_PENDING_EFFECT', choiceId: 'o1' }])
    expect(game.state.pendingEffect).toBeNull()
  })

  it('does nothing when the human owes the next action', () => {
    const g = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    g.state.pendingEffect = { effect: 'e', side: 'a', card: inst({}), kind: 'choice', prompt: '', options: [] }
    const { game, applied } = runBotUntilIdle(g, BOT, makeCtx(), basicPolicy)
    expect(applied).toEqual([])
    expect(game).toEqual(g)
  })

  it('falls back to the guaranteed action for each owed kind when the policy has only illegal ideas', () => {
    const turn = makeGame({ activePlayer: BOT, turnNumber: 3 })
    expect(runBotUntilIdle(turn, BOT, makeCtx(), stuckPolicy()).applied).toEqual([FALLBACK.turn])

    const response = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    response.state.zones[0].cards.a.push(zoneEntry({ instanceId: 'foe-1', playedOnTurn: 1 }))
    response.state.zones[0].cards.b.push(zoneEntry({ instanceId: 'sneak', keywords: ['stealthy'] }))
    response.state.awaitingResponse = {
      zoneId: 1, aggressor: 'a', attackerIds: ['foe-1'], targetIds: ['sneak'], stealthyIds: ['sneak'], omissibleIds: [],
    }
    const r = runBotUntilIdle(response, BOT, makeCtx(), stuckPolicy())
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
    const d = runBotUntilIdle(decision, BOT, makeCtx(), stuckPolicy())
    expect(d.applied).toEqual([FALLBACK.decision])
    expect(d.game.state.pendingReport).toBeNull()

    const choice = makeGame({ activePlayer: 'alice', turnNumber: 3 })
    choice.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: '', options: [{ id: 'o', label: 'O' }] }
    const c = runBotUntilIdle(choice, BOT, makeCtx(), stuckPolicy())
    expect(c.applied).toEqual([FALLBACK.choice])
    expect(c.game.state.pendingEffect).toBeNull()
  })

  it('caps a runaway policy and still ends the turn', () => {
    // SET_ALERT_CARD on your own ability card is accepted again and again
    // ("your own alert may be re-revealed"), which is exactly the loop the
    // cap exists for.
    const alert = inst({ instanceId: 'alert-1', type: 'ability', vehicleType: null })
    const g = makeGame({
      activePlayer: BOT, turnNumber: 3,
      privates: { a: { hand: [], deck: [] }, b: { hand: [alert], deck: [] } },
    })
    const runaway: BotPolicy = { candidates: () => [{ type: 'SET_ALERT_CARD', instanceId: 'alert-1' }] }
    const { game, applied } = runBotUntilIdle(g, BOT, makeCtx(), runaway)
    expect(applied).toHaveLength(BOT_ACTION_CAP + 1)
    expect(applied.slice(0, BOT_ACTION_CAP).every((a: GameAction) => a.type === 'SET_ALERT_CARD')).toBe(true)
    expect(applied.at(-1)).toEqual(FALLBACK.turn)
    expect(game.activePlayer).toBe('alice')
  })

  it('refuses a player who is not in the game', () => {
    const g = makeGame({ activePlayer: BOT, turnNumber: 3 })
    expect(() => runBotUntilIdle(g, 'stranger', makeCtx(), basicPolicy)).toThrow(/not in this game/)
  })
})
