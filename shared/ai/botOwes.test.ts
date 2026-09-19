import { describe, expect, it } from 'vitest'
import { inst, makeGame } from '../engine/testFixtures'
import { botOwes as fromDriver } from './botDriver'
import { botOwes } from './botOwes'

describe('botOwes', () => {
  it('is the driver\'s botOwes, moved: turn for the active bot, null for the human\'s turn and for a finished game', () => {
    expect(botOwes).toBe(fromDriver)
    const mine = makeGame({ activePlayer: 'bob' })
    expect(botOwes(mine, 'b')).toBe('turn')
    expect(botOwes(mine, 'a')).toBeNull()
    expect(botOwes({ ...mine, status: 'complete' }, 'b')).toBeNull()
  })
  it('puts a pending choice first, then the battle windows, in the order applyAction freezes things', () => {
    const g = makeGame({ activePlayer: 'bob' })
    g.state.pendingEffect = { effect: 'e', side: 'b', card: inst({}), kind: 'choice', prompt: 'Pick', options: [{ id: 'x', label: 'X' }] }
    expect(botOwes(g, 'b')).toBe('choice')
    expect(botOwes(g, 'a')).toBeNull()
  })
})
