import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VEHICLE_TYPES } from '../../shared/gameSettings'

// The cards table's vehicle_type CHECK must admit exactly the engine's types.
// A type the engine knows and the database refuses is invisible to every other
// test (they read the seed SOURCE), and fails the seed job's whole batch at
// merge (2026-09-22 hovercraft amendment §5). Reads the NEWEST migration that
// states the check, the way shared/battleReport.test.ts reads its migration.
function latestVehicleTypeCheck(): string[] {
  const dir = join(__dirname, '..', 'migrations')
  let latest: string[] | null = null
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8')
    for (const m of sql.matchAll(/check \(vehicle_type in \(([^)]*)\)\)/gi)) {
      latest = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    }
  }
  if (latest === null) throw new Error('no migration states the cards.vehicle_type check')
  return latest
}

describe('cards.vehicle_type check (migrations)', () => {
  it('admits exactly VEHICLE_TYPES', () => {
    expect([...latestVehicleTypeCheck()].sort()).toEqual([...Object.values(VEHICLE_TYPES)].sort())
  })
})
