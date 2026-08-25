import { DEFAULT_BASE_HP, MAX_ZONE_BASE_HP, ZONE_COUNT, ZONE_TYPES } from './gameSettings.ts'
import type { DeckRules } from './engine/deckValidation.ts'
import type { ZoneType } from './types.ts'

export interface ZoneSetting {
  biome: ZoneType
  baseHp: number
}

export interface LobbySettings {
  zones: ZoneSetting[]
  deckRules?: Partial<DeckRules>
}

const DECK_RULE_KEYS: (keyof DeckRules)[] = [
  'deckSize', 'uniqueCopyLimit', 'playerCardLimit', 'flierCopyLimit', 'subCopyLimit',
]

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  zones: Array.from({ length: ZONE_COUNT }, () => ({
    biome: ZONE_TYPES.WATER,
    baseHp: DEFAULT_BASE_HP,
  })),
}

export function validateLobbySettings(
  value: unknown,
): { settings: LobbySettings } | { errors: string[] } {
  const errors: string[] = []
  const zones = (value as { zones?: unknown } | null)?.zones
  if (!Array.isArray(zones) || zones.length !== ZONE_COUNT) {
    return { errors: [`Settings must define exactly ${ZONE_COUNT} zones`] }
  }
  const biomes = Object.values(ZONE_TYPES) as string[]
  for (const [i, zone] of zones.entries()) {
    const z = zone as { biome?: unknown; baseHp?: unknown }
    if (typeof z?.biome !== 'string' || !biomes.includes(z.biome)) {
      errors.push(`Zone ${i + 1}: unknown biome`)
    }
    if (
      typeof z?.baseHp !== 'number' ||
      !Number.isInteger(z.baseHp) ||
      z.baseHp < 1 ||
      z.baseHp > MAX_ZONE_BASE_HP
    ) {
      errors.push(`Zone ${i + 1}: base HP must be a whole number between 1 and ${MAX_ZONE_BASE_HP}`)
    }
  }
  const result: LobbySettings = { zones: zones as ZoneSetting[] }
  const deckRules = (value as { deckRules?: unknown }).deckRules
  if (deckRules !== undefined) {
    if (deckRules === null || typeof deckRules !== 'object' || Array.isArray(deckRules)) {
      errors.push('deckRules must be an object')
    } else {
      for (const [key, v] of Object.entries(deckRules)) {
        if (!DECK_RULE_KEYS.includes(key as keyof DeckRules)) {
          errors.push(`deckRules: unknown rule "${key}"`)
        } else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
          errors.push(`deckRules.${key} must be a positive whole number`)
        }
      }
      if (errors.length === 0) result.deckRules = deckRules as Partial<DeckRules>
    }
  }
  if (errors.length > 0) return { errors }
  return { settings: result }
}
