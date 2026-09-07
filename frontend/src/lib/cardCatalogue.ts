import type { CardRow } from './cards'

/** The fields the catalogue filter reads; a full `CardRow` satisfies it. */
export type CatalogueCard = Pick<CardRow, 'is_built_in' | 'faction' | 'meta'>

/**
 * A card a balance pass retired (2026-09-02 spec §2.1). The row stays seeded so
 * in-flight games and saved decks still resolve, and `retired: true` in meta is
 * the only mark it carries — so every card list has to exclude it itself.
 * Checked by value, not by key presence, like the engine's `poolEligible`.
 */
export function isRetiredCard(card: Pick<CardRow, 'meta'>): boolean {
  return (card.meta as { retired?: unknown } | null)?.retired === true
}

/**
 * What the Cards page shows for a tab: custom cards on CUSTOM, one faction's
 * built-ins otherwise, and never a retired card. Nothing upstream filters
 * those — the deck builder does it for its pool, this does it for the catalogue.
 */
export function catalogueCards<T extends CatalogueCard>(cards: readonly T[], tab: string | null): T[] {
  if (tab === null) return []
  return cards.filter((c) => {
    if (isRetiredCard(c)) return false
    return tab === 'CUSTOM' ? !c.is_built_in : c.is_built_in && c.faction === tab
  })
}
