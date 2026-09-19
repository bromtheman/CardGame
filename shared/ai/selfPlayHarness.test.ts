import { describe, expect, it } from 'vitest'
import { shipProfilesForFaction } from '../shipProfiles'
import { BOT_FACTIONS } from './botDecks'
import { parseFactions, profiledFactions } from './selfPlayHarness'

describe('profiledFactions', () => {
  it('lists exactly the bot factions with ship profiles, in BOT_FACTIONS order', () => {
    const got = profiledFactions()
    expect(got).toEqual(BOT_FACTIONS.filter((f) => shipProfilesForFaction(f).length > 0))
    expect(got.length).toBeGreaterThanOrEqual(3)   // DWG, SS, WF as of 2026-09
    for (const f of got) expect(shipProfilesForFaction(f).length).toBeGreaterThan(0)
  })
})

describe('parseFactions', () => {
  it('defaults to the profiled factions, parses a comma list case-insensitively, and refuses an unknown one', () => {
    expect(parseFactions('')).toEqual(profiledFactions())
    expect(parseFactions(undefined)).toEqual(profiledFactions())
    expect(parseFactions(' dwg, SS ')).toEqual(['DWG', 'SS'])
    expect(() => parseFactions('DWG,XX')).toThrow(/XX/)
    expect(() => parseFactions('DWG')).toThrow(/two/)   // a pairing needs at least two
  })
})
