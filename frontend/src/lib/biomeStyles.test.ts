import { describe, expect, it } from 'vitest'
import { ZONE_TYPES } from '@shared/gameSettings'
import { BIOME_BORDER, BIOME_TINT } from './biomeStyles'

describe('biome styles', () => {
  it('tints every biome the engine can put on a zone', () => {
    for (const biome of Object.values(ZONE_TYPES)) {
      expect(BIOME_TINT[biome], `missing tint for ${biome}`).toBeDefined()
      expect(BIOME_TINT[biome].length).toBeGreaterThan(0)
    }
  })

  it('gives every biome a border', () => {
    for (const biome of Object.values(ZONE_TYPES)) {
      expect(BIOME_BORDER[biome], `missing border for ${biome}`).toBeDefined()
      expect(BIOME_BORDER[biome].length).toBeGreaterThan(0)
    }
  })

  it('gives each biome a distinct tint, so two biomes never render alike', () => {
    const tints = Object.values(ZONE_TYPES).map((b) => BIOME_TINT[b])
    expect(new Set(tints).size).toBe(tints.length)
  })
})
