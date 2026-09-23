import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VEHICLE_TYPES, ZONE_TYPES } from './gameSettings.ts'
import { biomeAllows } from './engine/index.ts'
import { isShipClass, isShipOrSub } from './vehicleClass.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

// 2026-09-23 owner request: DWG's Boarding Party may take an enemy submarine.
describe('isShipOrSub', () => {
  it('is true for ships, hovercraft and submarines, and nothing else', () => {
    expect(isShipOrSub(VEHICLE_TYPES.SHIP)).toBe(true)
    expect(isShipOrSub(VEHICLE_TYPES.HOVER)).toBe(true)
    expect(isShipOrSub(VEHICLE_TYPES.SUB)).toBe(true)
    for (const t of [VEHICLE_TYPES.TANK, VEHICLE_TYPES.PLANE, VEHICLE_TYPES.AIRSHIP, null, undefined]) {
      expect(isShipOrSub(t), String(t)).toBe(false)
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

// The amendment's premise is that no rule compares a vehicle type to the ship
// value — every one asks isShipClass. A direct comparison compiles, passes
// every test written before it, and quietly treats a hovercraft as a
// non-ship, so this reads the source instead (the handStamp.test.ts way) and
// names the file and line of any comparison that creeps back in.
describe('no rule compares a vehicle type to the ship value directly', () => {
  const SHIP = String.raw`(?:VEHICLE_TYPES\.SHIP|'ship'|"ship")`
  const COMPARISON = new RegExp(String.raw`(?:===|!==)\s*${SHIP}|${SHIP}\s*(?:===|!==)`)
  const ALLOWED = new Set([
    // Where the question is answered.
    'shared/vehicleClass.ts',
    // vehicleTypeMatches compares a pool FILTER's wanted value, not a
    // vehicle's type, and then asks isShipClass.
    'shared/effects/primitives.ts',
  ])

  it('asks isShipClass everywhere in shared/ and frontend/src/', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        const rel = relative(ROOT, p).split(sep).join('/')
        if (e.isDirectory()) {
          // Generated FtD report data, not rules.
          if (rel !== 'shared/shipProfiles') walk(p)
          continue
        }
        if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name) || ALLOWED.has(rel)) continue
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (COMPARISON.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    walk(join(ROOT, 'shared'))
    walk(join(ROOT, 'frontend', 'src'))
    expect(offenders, 'compare a vehicle type through isShipClass (shared/vehicleClass.ts), never against the ship value').toEqual([])
  })
})
