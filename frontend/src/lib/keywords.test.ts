import { describe, expect, it } from 'vitest'
import { KEYWORDS, VEHICLE_TYPES } from '@shared/gameSettings'
import {
  KEYWORD_INFO, VEHICLE_TYPE_INFO, attributesOf, chargeAttributesOf, keywordLabel,
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

// Wave 7, ruling E-3. TG Vengeful is a submarine whose card text deals base
// damage, so the glossary can no longer say a sub "can never damage an enemy
// base" — the rule it was describing is the BOMBARDMENT roster
// (baseStrikersIn), not card-forced damage. This pins the narrowed wording, so
// the contradiction cannot quietly come back.
describe('submarine base-damage wording (wave 7)', () => {
  const sub = VEHICLE_TYPE_INFO[VEHICLE_TYPES.SUB]

  it('scopes the prohibition to bombardment', () => {
    expect(sub.description).toContain('never bombard an enemy base')
  })

  it('no longer claims a card effect cannot damage one', () => {
    expect(sub.description).not.toContain('never damage an enemy base')
  })
})

// 2026-09-21 LH Charge (spec §3.1–§3.3). These rows are the ONLY place the
// game explains how charge is earned and spent, so each one is pinned to the
// rule it describes — in particular the two that players confuse: Requires
// reads the whole board and spends nothing, Discharge comes from one hull.
describe('chargeAttributesOf', () => {
  const labels = (meta: Record<string, unknown>) => chargeAttributesOf(meta).map((a) => a.label)
  const body = (meta: Record<string, unknown>, key: string) =>
    chargeAttributesOf(meta).find((a) => a.key === key)!.description

  it('says nothing about charge for a card that carries none', () => {
    expect(chargeAttributesOf({})).toEqual([])
    expect(chargeAttributesOf({ activateCpCost: 0 })).toEqual([])
  })

  it('names the cap and the default one-per-turn tick', () => {
    expect(labels({ chargeMax: 2 })).toEqual(['Charge 2'])
    const text = body({ chargeMax: 2 }, 'charge')
    expect(text).toContain('up to 2')
    expect(text).toContain('1 charge at the start of each of your turns')
  })

  it('names a faster tick instead, for a hull that prints its own rate', () => {
    // Terawatt: "Generators — this gains 2 charge at the start of your turn".
    const text = body({ chargeMax: 4, chargeRate: 2 }, 'charge')
    expect(text).toContain('2 charge at the start of each of your turns')
    expect(text).not.toContain('1 charge at the start')
  })

  it('says charge is per-vehicle, never a shared pool', () => {
    expect(body({ chargeMax: 2 }, 'charge')).toContain('this vehicle alone')
  })

  it('explains a relay as a zone effect that does not stack', () => {
    expect(labels({ chargeRelay: 1 })).toEqual(['Charge Relay 1'])
    const text = body({ chargeRelay: 1 }, 'chargeRelay')
    expect(text).toContain('this zone')
    expect(text).toContain('do not stack')
  })

  it('explains Requires as a whole-board total that is checked, never spent', () => {
    expect(labels({ chargeMax: 2, requiresCharge: 3 })).toEqual(['Charge 2', 'Requires 3 Charge'])
    const text = body({ requiresCharge: 3 }, 'requiresCharge')
    expect(text).toContain('whole board')
    expect(text).toContain('does not spend')
  })

  it('explains Discharge as a cost paid by the one vehicle, plus its activation', () => {
    const text = body({ chargeMax: 2, dischargeCost: 2 }, 'discharge')
    expect(text).toContain('from this vehicle alone')
    expect(text).toContain('activation')
  })

  it('explains an ability card’s discharge as one host that must hold the whole cost', () => {
    expect(labels({ dischargeFrom: 2 })).toEqual(['Discharge 2 from a friendly LH vehicle'])
    const text = body({ dischargeFrom: 2 }, 'dischargeFrom')
    expect(text).toContain('cannot split')
    expect(text).toContain('one')
  })

  it('lists every charge rule a single card carries, cap first', () => {
    // Terawatt's full meta: the busiest card in the faction.
    expect(labels({ chargeMax: 4, chargeRate: 2, requiresCharge: 3, dischargeCost: 2 }))
      .toEqual(['Charge 4', 'Requires 3 Charge', 'Discharge 2'])
  })

  it('ignores a zero or malformed value rather than printing “Charge 0”', () => {
    expect(chargeAttributesOf({ chargeMax: 0, requiresCharge: null, dischargeFrom: 'two' })).toEqual([])
  })
})

describe('attributesOf with charge', () => {
  it('slots the charge rules between the vehicle type and the keywords', () => {
    const attrs = attributesOf(VEHICLE_TYPES.SHIP, [KEYWORDS.BLOCKER], { chargeMax: 2, requiresCharge: 3 })
    expect(attrs.map((a) => a.label)).toEqual(['Ship', 'Charge 2', 'Requires 3 Charge', 'Blocker'])
  })

  it('leaves a card with no charge meta exactly as it was', () => {
    expect(attributesOf(VEHICLE_TYPES.SHIP, [KEYWORDS.BLOCKER], {}).map((a) => a.label))
      .toEqual(['Ship', 'Blocker'])
  })
})
