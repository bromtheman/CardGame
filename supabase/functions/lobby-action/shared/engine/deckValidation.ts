import {
  DECK_SIZE, FACTIONS, FLIER_COPY_LIMIT, PLAYER_CARD_LIMIT, SUB_COPY_LIMIT,
  UNIQUE_COPY_LIMIT, VEHICLE_TYPES,
} from '../gameSettings.ts'

export interface DeckRules {
  deckSize: number
  uniqueCopyLimit: number
  playerCardLimit: number
  flierCopyLimit: number
  subCopyLimit: number
}

export const DEFAULT_DECK_RULES: DeckRules = {
  deckSize: DECK_SIZE,
  uniqueCopyLimit: UNIQUE_COPY_LIMIT,
  playerCardLimit: PLAYER_CARD_LIMIT,
  flierCopyLimit: FLIER_COPY_LIMIT,
  subCopyLimit: SUB_COPY_LIMIT,
}

export interface DeckCardInfo {
  id: string
  isBuiltIn: boolean
  faction: string
  vehicleType: string | null
  ownerId: string | null
}

export interface DeckValidationResult {
  valid: boolean
  errors: string[]
  cardCount: number
}

export function validateDeck(
  deck: { faction: string; cards: Record<string, number> },
  cardInfo: Map<string, DeckCardInfo>,
  ownerId: string,
  rules: DeckRules = DEFAULT_DECK_RULES,
): DeckValidationResult {
  const errors: string[] = []
  let cardCount = 0
  let customCopies = 0
  let flierCopies = 0
  let subCopies = 0

  for (const [cardId, qty] of Object.entries(deck.cards)) {
    if (!Number.isInteger(qty) || qty < 1) {
      errors.push(`Card ${cardId} has an invalid quantity (${qty})`)
      continue
    }
    cardCount += qty
    if (qty > rules.uniqueCopyLimit) {
      errors.push(`Card ${cardId}: max ${rules.uniqueCopyLimit} copies allowed (${qty} present)`)
    }
    const card = cardInfo.get(cardId)
    if (!card) {
      errors.push(`Unknown card id: ${cardId}`)
      continue
    }
    if (card.isBuiltIn) {
      if (card.faction !== deck.faction && card.faction !== FACTIONS.NEUTRAL) {
        errors.push(`${cardId} is a ${card.faction} card; this deck is ${deck.faction}`)
      }
    } else {
      customCopies += qty
      if (card.ownerId !== ownerId) {
        errors.push(`${cardId} is another player's custom card`)
      }
    }
    if (card.vehicleType === VEHICLE_TYPES.PLANE || card.vehicleType === VEHICLE_TYPES.AIRSHIP) {
      flierCopies += qty
    }
    if (card.vehicleType === VEHICLE_TYPES.SUB) {
      subCopies += qty
    }
  }

  if (cardCount !== rules.deckSize) {
    errors.push(`Deck must contain exactly ${rules.deckSize} cards (currently ${cardCount})`)
  }
  if (customCopies > rules.playerCardLimit) {
    errors.push(`Max ${rules.playerCardLimit} custom card copies allowed (${customCopies} present)`)
  }
  if (flierCopies > rules.flierCopyLimit) {
    errors.push(`Max ${rules.flierCopyLimit} flier copies allowed (${flierCopies} present)`)
  }
  if (subCopies > rules.subCopyLimit) {
    errors.push(`Max ${rules.subCopyLimit} submarine copies allowed (${subCopies} present)`)
  }

  return { valid: errors.length === 0, errors, cardCount }
}
