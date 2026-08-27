import { describe, expect, it } from 'vitest'
import { UNIQUE_COPY_LIMIT } from '@shared/gameSettings'
import { MAX_COPIES_PER_CARD, setDeckCopies } from './deckEditing'

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
