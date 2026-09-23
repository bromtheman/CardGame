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

/** The two fields of a `cards` row the deck list ranks by. */
type ListedCard = { name: string; material_cost: number }

/**
 * The deck list's rows, cheapest first (owner, 2026-09-23) — by the material
 * cost each row prints, the same order the pool beside it arrives in
 * (`useCardsQuery` orders by `material_cost`). Equal costs fall back to name,
 * so a tie holds still instead of sitting in the order the cards were added.
 *
 * A card the catalogue no longer holds has no price to rank by. It sinks to
 * the bottom rather than dropping out, so the owner can still remove it.
 */
export function deckListOrder(
  cards: DeckCards,
  cardById: ReadonlyMap<string, ListedCard>,
): Array<[cardId: string, copies: number]> {
  return Object.entries(cards).sort(([a], [b]) => {
    const ca = cardById.get(a)
    const cb = cardById.get(b)
    if (!ca || !cb) return Number(!ca) - Number(!cb)
    return ca.material_cost - cb.material_cost || ca.name.localeCompare(cb.name)
  })
}
