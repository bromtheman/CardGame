import { describe, expect, it } from 'vitest'
import { MAX_VEHICLES_PER_ZONE_SIDE } from '../gameSettings.ts'
import { makeGame, zoneEntry } from './testFixtures.ts'
import { zoneCapFor } from './zoneCapacity.ts'

const denier = (n: unknown) => zoneEntry({ name: 'Tiger Shark', meta: { slotDenial: n } })

describe('zoneCapFor', () => {
  it('is the flat cap when no enemy hull denies a slot', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(zoneEntry({ name: 'Plain' }))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE)
  })

  it('subtracts an enemy hull slotDenial from the asking side cap', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(denier(3))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE - 3)
  })

  // R-1: "This does not stack." MAX, never SUM — which is exactly what makes a
  // second Tiger Shark inert rather than lethal. A sum would put two of them at
  // 8 - 6 = 2 slots and three at zero, which the card does not say.
  it('takes the LARGEST denial in the zone, never their sum', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(denier(3), denier(3))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE - 3)
  })

  it('takes the largest of UNEQUAL denials', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(denier(1), denier(3), denier(2))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE - 3)
  })

  // The pronoun, the same one aircraftLocked draws against screenBlocks: a
  // Tiger Shark denies slots to its OPPONENT, so it never shrinks the cap on
  // its own side of the zone.
  it('reads the ENEMY side only — your own denier does not shrink your cap', () => {
    const g = makeGame()
    g.state.zones[0].cards.a.push(denier(3))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE)
    expect(zoneCapFor(g.state, 'b', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE - 3)
  })

  it('is per zone — a denier in zone 1 does not touch zone 2', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(denier(3))
    expect(zoneCapFor(g.state, 'a', 2)).toBe(MAX_VEHICLES_PER_ZONE_SIDE)
  })

  // A data key's VALUE is never checked by any guard, only its presence
  // (docs/claude/card-effects.md, blind spot 4). A mistyped one must leave the
  // cap alone rather than produce NaN, which every `>=` comparison downstream
  // would read as "not full" and silently disable the cap entirely.
  it.each([['three'], [null], [undefined], [0], [-2], [NaN], [Infinity]])(
    'ignores a slotDenial of %s', (raw) => {
      const g = makeGame()
      g.state.zones[0].cards.b.push(denier(raw))
      expect(zoneCapFor(g.state, 'a', 1)).toBe(MAX_VEHICLES_PER_ZONE_SIDE)
    },
  )

  it('never returns a negative cap', () => {
    const g = makeGame()
    g.state.zones[0].cards.b.push(denier(MAX_VEHICLES_PER_ZONE_SIDE + 5))
    expect(zoneCapFor(g.state, 'a', 1)).toBe(0)
  })

  // Fail-OPEN, unlike zoneFull's fail-closed default. The two are not in
  // conflict: zoneFull keeps its own `if (!zone) return true`, so a missing
  // zone is still unplayable. This function answers only "what is the cap
  // here?", and with no zone there is no denier to observe.
  it('reports the flat cap for a zone that does not exist', () => {
    expect(zoneCapFor(makeGame().state, 'a', 99)).toBe(MAX_VEHICLES_PER_ZONE_SIDE)
  })
})
