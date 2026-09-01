import { describe, expect, it } from 'vitest'

import {
  BATTLE_REPORT_WIRE_VERSION,
  MAX_REPORTED_VEHICLES,
  battleKeyOf,
  buildPrefillResults,
  hpFromVehicle,
  sideForTeamIndex,
} from './battleReport.ts'

const battle = {
  zoneId: 2,
  aggressor: 'a',
  attackerIds: ['atk-2', 'atk-1'],
  defenderIds: ['def-1'],
}

describe('battleKeyOf', () => {
  it('is stable regardless of the order ids arrive in', () => {
    expect(battleKeyOf(battle)).toBe(
      battleKeyOf({ ...battle, attackerIds: ['atk-1', 'atk-2'] }),
    )
  })

  it('does not mutate the arrays it sorts', () => {
    const attackerIds = ['b', 'a']
    battleKeyOf({ ...battle, attackerIds })
    expect(attackerIds).toEqual(['b', 'a'])
  })

  it('changes when the roster changes', () => {
    expect(battleKeyOf({ ...battle, defenderIds: ['def-1', 'def-2'] }))
      .not.toBe(battleKeyOf(battle))
  })

  it('changes when the zone or the aggressor changes', () => {
    expect(battleKeyOf({ ...battle, zoneId: 3 })).not.toBe(battleKeyOf(battle))
    expect(battleKeyOf({ ...battle, aggressor: 'b' })).not.toBe(battleKeyOf(battle))
  })

  it('ignores the battle distance, which Tactical Positioning may move mid-battle', () => {
    // A token minted before the nudge must still be redeemable after it —
    // the player has already downloaded the file and started fighting.
    const withDistance = { ...battle, distanceM: 1500 } as typeof battle
    expect(battleKeyOf(withDistance)).toBe(battleKeyOf(battle))
  })
})

describe('hpFromVehicle', () => {
  it('scales the alive fraction to a percentage', () => {
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: 0.87, exists: true })).toBe(87)
  })

  it('rounds to the nearest whole percent', () => {
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: 0.865, exists: true })).toBe(87)
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: 0.8649, exists: true })).toBe(86)
  })

  it('reports a vehicle that no longer exists as 0, whatever its fraction says', () => {
    // FtD's own cleanup rules (TooDamaged 0.55, DamagedAndSinking 0.8) despawn
    // a hull well before its alive fraction reaches zero, so this is the
    // ordinary case for a destroyed ship, not an edge case.
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: 0.6, exists: false })).toBe(0)
  })

  it('clamps out-of-range fractions instead of trusting them', () => {
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: 1.4 })).toBe(100)
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: -0.2 })).toBe(0)
  })

  it('treats a missing or non-finite fraction as 0 rather than NaN', () => {
    expect(hpFromVehicle({ instanceId: 'x' })).toBe(0)
    expect(hpFromVehicle({ instanceId: 'x', aliveFraction: Number.NaN })).toBe(0)
  })

  it('never returns a value SUBMIT_BATTLE_REPORT would reject', () => {
    for (const f of [-5, 0, 0.001, 0.5, 0.999, 1, 12]) {
      const hp = hpFromVehicle({ instanceId: 'x', aliveFraction: f })
      expect(Number.isInteger(hp)).toBe(true)
      expect(hp).toBeGreaterThanOrEqual(0)
      expect(hp).toBeLessThanOrEqual(100)
    }
  })
})

describe('buildPrefillResults', () => {
  const ok = {
    winningTeamIndex: 0,
    vehicles: [
      { instanceId: 'i-1', name: 'Marauder', aliveFraction: 0.87, exists: true },
      { instanceId: 'i-2', name: 'Bulwark', aliveFraction: 0.2, exists: false },
    ],
  }

  it('maps every vehicle to its HP', () => {
    const r = buildPrefillResults(ok)
    expect(r).toEqual({
      ok: true,
      results: { 'i-1': 87, 'i-2': 0 },
      names: { 'i-1': 'Marauder', 'i-2': 'Bulwark' },
    })
  })

  it('rejects a body with no vehicles array', () => {
    const r = buildPrefillResults({})
    expect(r.ok).toBe(false)
  })

  it('rejects an empty roster', () => {
    expect(buildPrefillResults({ vehicles: [] }).ok).toBe(false)
  })

  it('rejects more vehicles than the cap', () => {
    const many = Array.from({ length: MAX_REPORTED_VEHICLES + 1 }, (_, i) => ({
      instanceId: `i-${i}`, aliveFraction: 1,
    }))
    const r = buildPrefillResults({ vehicles: many })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(String(MAX_REPORTED_VEHICLES))
  })

  it('rejects an entry with no instance id', () => {
    expect(buildPrefillResults({ vehicles: [{ aliveFraction: 1 }] }).ok).toBe(false)
    expect(buildPrefillResults({ vehicles: [{ instanceId: '' }] }).ok).toBe(false)
  })

  it('rejects a duplicated vehicle rather than silently keeping the last', () => {
    const r = buildPrefillResults({
      vehicles: [
        { instanceId: 'i-1', name: 'Marauder', aliveFraction: 1 },
        { instanceId: 'i-1', name: 'Marauder', aliveFraction: 0 },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Marauder')
  })

  it('rejects a non-object entry', () => {
    expect(buildPrefillResults({ vehicles: ['nope'] }).ok).toBe(false)
    expect(buildPrefillResults({ vehicles: [null] }).ok).toBe(false)
  })

  it('omits a name it was not given rather than inventing one', () => {
    const r = buildPrefillResults({ vehicles: [{ instanceId: 'i-1', aliveFraction: 1 }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.names).toEqual({})
  })

  it('accepts an id the battle does not contain — the engine is the authority on the roster', () => {
    // SUBMIT_BATTLE_REPORT refuses a report that does not cover exactly
    // battleParticipants. Re-enforcing that here would mean teaching
    // battle-report the whole engine to catch something already caught.
    const r = buildPrefillResults({ vehicles: [{ instanceId: 'not-in-this-battle', aliveFraction: 1 }] })
    expect(r.ok).toBe(true)
  })

  it('pins the wire version the mod is written against', () => {
    expect(BATTLE_REPORT_WIRE_VERSION).toBe(1)
  })
})

describe('sideForTeamIndex', () => {
  // battleTeams.ts emits the aggressor first, and buildCustomBattle writes
  // Teams in the order it is handed — so team 0 is the aggressor in both the
  // file's Teams and its CardGame.Teams.
  it('maps team 0 to the aggressor and team 1 to the defender', () => {
    expect(sideForTeamIndex('a', 0)).toBe('a')
    expect(sideForTeamIndex('a', 1)).toBe('b')
    expect(sideForTeamIndex('b', 0)).toBe('b')
    expect(sideForTeamIndex('b', 1)).toBe('a')
  })

  it('returns null for an index that is neither team rather than guessing', () => {
    expect(sideForTeamIndex('a', 2)).toBeNull()
    expect(sideForTeamIndex('a', -1)).toBeNull()
  })
})
