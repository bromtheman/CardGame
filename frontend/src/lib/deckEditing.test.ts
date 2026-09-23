import { describe, expect, it } from 'vitest'
import { UNIQUE_COPY_LIMIT } from '@shared/gameSettings'
import { MAX_COPIES_PER_CARD, deckListOrder, setDeckCopies } from './deckEditing'

describe('setDeckCopies', () => {
  it('tracks the engine copy limit', () => {
    expect(MAX_COPIES_PER_CARD).toBe(UNIQUE_COPY_LIMIT)
  })

  it('adds a card that was not in the deck', () => {
    expect(setDeckCopies({}, 'a', 1)).toEqual({ a: 1 })
  })

  it('caps at the copy limit instead of adding a third copy', () => {
    expect(setDeckCopies({ a: MAX_COPIES_PER_CARD }, 'a', MAX_COPIES_PER_CARD + 1))
      .toEqual({ a: MAX_COPIES_PER_CARD })
  })

  it('removes the entry at zero rather than storing a zero quantity', () => {
    expect(setDeckCopies({ a: 1, b: 2 }, 'a', 0)).toEqual({ b: 2 })
  })

  it('clamps negatives to a removal', () => {
    expect(setDeckCopies({ a: 1 }, 'a', -3)).toEqual({})
  })

  it('never stores a non-finite quantity', () => {
    expect(setDeckCopies({ a: 1 }, 'a', Number.NaN)).toEqual({})
  })

  it('leaves the other cards and the original object untouched', () => {
    const before = { a: 1, b: 1 }
    const after = setDeckCopies(before, 'b', 2)
    expect(after).toEqual({ a: 1, b: 2 })
    expect(before).toEqual({ a: 1, b: 1 })
  })
})

describe('deckListOrder', () => {
  it('lists the deck cheapest first, whatever order the cards were added in', () => {
    const catalogue = new Map([
      ['frigate', { name: 'Frigate', material_cost: 250_000 }],
      ['dreadnought', { name: 'Dreadnought', material_cost: 1_200_000 }],
      ['skiff', { name: 'Skiff', material_cost: 100_000 }],
    ])
    expect(deckListOrder({ dreadnought: 1, skiff: 2, frigate: 1 }, catalogue))
      .toEqual([['skiff', 2], ['frigate', 1], ['dreadnought', 1]])
  })

  it('breaks a cost tie by name, not by the order the cards were added in', () => {
    const catalogue = new Map([
      ['id-1', { name: 'Walrus', material_cost: 200_000 }],
      ['id-2', { name: 'Albatross', material_cost: 200_000 }],
    ])
    expect(deckListOrder({ 'id-1': 1, 'id-2': 1 }, catalogue))
      .toEqual([['id-2', 1], ['id-1', 1]])
  })

  // A deck can outlive a card (a deleted custom card): its row must stay so
  // the owner can remove it, but it has no price to rank by.
  it('keeps a card missing from the catalogue, last, rather than pricing it at zero', () => {
    const catalogue = new Map([['skiff', { name: 'Skiff', material_cost: 100_000 }]])
    expect(deckListOrder({ deleted: 1, skiff: 1 }, catalogue))
      .toEqual([['skiff', 1], ['deleted', 1]])
  })
})
