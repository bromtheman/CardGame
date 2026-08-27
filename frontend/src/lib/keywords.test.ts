import { describe, expect, it } from 'vitest'
import { KEYWORDS, VEHICLE_TYPES } from '@shared/gameSettings'
import {
  KEYWORD_INFO, VEHICLE_TYPE_INFO, attributesOf, keywordLabel,
} from './keywords'

describe('keyword glossary', () => {
  it('explains every keyword the engine can put on a card', () => {
    for (const keyword of Object.values(KEYWORDS)) {
      expect(KEYWORD_INFO[keyword], `missing glossary entry for ${keyword}`).toBeDefined()
      expect(KEYWORD_INFO[keyword].description.length).toBeGreaterThan(0)
    }
  })

  it('explains every vehicle type', () => {
    for (const type of Object.values(VEHICLE_TYPES)) {
      expect(VEHICLE_TYPE_INFO[type], `missing glossary entry for ${type}`).toBeDefined()
      expect(VEHICLE_TYPE_INFO[type].description.length).toBeGreaterThan(0)
    }
  })

  it('keys every entry by its own map key', () => {
    for (const [key, info] of Object.entries({ ...KEYWORD_INFO, ...VEHICLE_TYPE_INFO })) {
      expect(info.key).toBe(key)
    }
  })
})

describe('keywordLabel', () => {
  it('maps a known keyword to its display label', () => {
    expect(keywordLabel(KEYWORDS.AIR_SCREEN)).toBe('Air Screen')
  })

  it('falls back to the raw key for an unknown keyword', () => {
    expect(keywordLabel('somethingNew')).toBe('somethingNew')
  })
})

describe('attributesOf', () => {
  it('lists the vehicle type first, then the keywords in order', () => {
    const attrs = attributesOf(VEHICLE_TYPES.PLANE, [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY])
    expect(attrs.map((a) => a.label)).toEqual(['Plane', 'Half-Cost', 'Temporary'])
  })

  it('omits the type row for a card with no vehicle type', () => {
    expect(attributesOf(null, [KEYWORDS.BLOCKER]).map((a) => a.label)).toEqual(['Blocker'])
  })

  it('still lists an unknown keyword so it is never silently hidden', () => {
    const [attr] = attributesOf(null, ['mysteryKeyword'])
    expect(attr.label).toBe('mysteryKeyword')
    expect(attr.description.length).toBeGreaterThan(0)
  })

  it('returns nothing for a card with no type and no keywords', () => {
    expect(attributesOf(null, [])).toEqual([])
  })
})
