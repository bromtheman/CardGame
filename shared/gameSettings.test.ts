import { describe, expect, it } from 'vitest'
import {
  DECK_FACTIONS, DECK_SIZE, FACTIONS, KEYWORDS, MATERIALS_PER_TURN,
  MAX_MATERIALS_PER_TURN, MIN_MATERIALS_PER_TURN, TRIGGERS, UNIQUE_COPY_LIMIT,
} from './gameSettings'

describe('gameSettings', () => {
  it('has spec defaults', () => {
    expect(DECK_SIZE).toBe(20)
    expect(UNIQUE_COPY_LIMIT).toBe(2)
    expect(DECK_FACTIONS).toEqual(['DWG', 'GT', 'LH', 'OW', 'SS', 'WF'])
  })
  it('defaults income to 75k per turn, inside the lobby-selectable range', () => {
    expect(MATERIALS_PER_TURN).toBe(75_000)
    expect(MIN_MATERIALS_PER_TURN).toBeLessThanOrEqual(MATERIALS_PER_TURN)
    expect(MAX_MATERIALS_PER_TURN).toBeGreaterThanOrEqual(MATERIALS_PER_TURN)
  })
  it('deck factions are real factions', () => {
    for (const f of DECK_FACTIONS) expect(Object.values(FACTIONS)).toContain(f)
  })
  it('keywords and triggers match old-BE spellings', () => {
    expect(KEYWORDS.HALF_COST).toBe('halfCost')
    expect(TRIGGERS.ON_PLAY).toBe('onPlayEffect')
  })
})
