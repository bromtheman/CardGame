import { describe, expect, it } from 'vitest'
import { inst, makeGame } from '../engine/testFixtures'
import { viewFor } from './botView'

describe('viewFor', () => {
  it('carries the public state and only the bot\'s own hand', () => {
    const mine = inst({ instanceId: 'mine-hand-1' })
    const theirsHand = inst({ instanceId: 'their-hand-1' })
    const theirsDeck = inst({ instanceId: 'their-deck-1' })
    const myDeck = inst({ instanceId: 'mine-deck-1' })
    const g = makeGame({
      turnNumber: 4.5,
      privates: { a: { hand: [theirsHand], deck: [theirsDeck] }, b: { hand: [mine], deck: [myDeck] } },
    })
    const rng = () => 0.5
    const view = viewFor(g, 'b', rng)
    expect(view.side).toBe('b')
    expect(view.turnNumber).toBe(4.5)
    expect(view.state).toBe(g.state)
    expect(view.settings).toBe(g.settings)
    expect(view.rng).toBe(rng)
    expect(view.hand.map((c) => c.instanceId)).toEqual(['mine-hand-1'])
    // Hidden information by construction (spec §5.3): nothing from the
    // opponent's hand or deck — and not even the bot's own deck order — is
    // reachable from the view.
    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain('their-hand-1')
    expect(serialised).not.toContain('their-deck-1')
    expect(serialised).not.toContain('mine-deck-1')
    expect(serialised).toContain('mine-hand-1')
  })
})
