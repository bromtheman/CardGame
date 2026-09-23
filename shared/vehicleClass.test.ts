import { describe, expect, it } from 'vitest'
import { VEHICLE_TYPES, ZONE_TYPES } from './gameSettings.ts'
import { biomeAllows } from './engine/index.ts'
import { isShipClass } from './vehicleClass.ts'

// 2026-09-22 hovercraft amendment §4: a Hovercraft is a ship in every rule.
describe('isShipClass', () => {
  it('is true for ships and hovercraft, and nothing else', () => {
    expect(isShipClass(VEHICLE_TYPES.SHIP)).toBe(true)
    expect(isShipClass(VEHICLE_TYPES.HOVER)).toBe(true)
    for (const t of [VEHICLE_TYPES.SUB, VEHICLE_TYPES.TANK, VEHICLE_TYPES.PLANE, VEHICLE_TYPES.AIRSHIP, null, undefined]) {
      expect(isShipClass(t), String(t)).toBe(false)
    }
  })
})

describe('hovercraft placement', () => {
  it('deploys to water and beach zones, like a ship, and never to land', () => {
    expect(biomeAllows(VEHICLE_TYPES.HOVER, ZONE_TYPES.WATER)).toBe(true)
    expect(biomeAllows(VEHICLE_TYPES.HOVER, ZONE_TYPES.BEACH)).toBe(true)
    expect(biomeAllows(VEHICLE_TYPES.HOVER, ZONE_TYPES.LAND)).toBe(false)
  })
})
