import { UNIQUE_COPY_LIMIT } from '@shared/gameSettings'

export type DeckCards = Record<string, number>

/** The most copies of one card a legal deck may hold (spec §5). */
export const MAX_COPIES_PER_CARD = UNIQUE_COPY_LIMIT

/**
 * Set how many copies of one card the deck holds, clamped to
 * 0…MAX_COPIES_PER_CARD so a stepper can never push a deck past the copy limit
 * or below zero.
 *
 * Zero deletes the entry instead of storing `0`: `validateDeck` reports any
 * non-positive quantity as an invalid quantity, so a card stepped back down to
 * nothing must leave no trace behind.
 */
export function setDeckCopies(cards: DeckCards, cardId: string, copies: number): DeckCards {
  const requested = Number.isFinite(copies) ? Math.trunc(copies) : 0
  const clamped = Math.min(MAX_COPIES_PER_CARD, Math.max(0, requested))
  const next = { ...cards }
  if (clamped === 0) delete next[cardId]
  else next[cardId] = clamped
  return next
}
