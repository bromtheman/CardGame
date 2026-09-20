import { describe, expect, it } from 'vitest'
import { shipProfilesForFaction } from '../shipProfiles'
import { BOT_FACTIONS } from './botDecks'
import { matchupFor, parseFactions, parsePairing, profiledFactions } from './selfPlayHarness'

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
  })
  it('accepts a single faction for mirror play but needs two to cross them', () => {
    expect(parseFactions('WF')).toEqual(['WF'])
    expect(parseFactions('WF', 'mirror')).toEqual(['WF'])
    expect(() => parseFactions('WF', 'cross')).toThrow(/two/)
    expect(parseFactions('WF,DWG', 'cross')).toEqual(['WF', 'DWG'])
  })
})

describe('parsePairing', () => {
  it('defaults to mirror, accepts cross in any case, and refuses anything else', () => {
    expect(parsePairing('')).toBe('mirror')
    expect(parsePairing(undefined)).toBe('mirror')
    expect(parsePairing('Cross')).toBe('cross')
    expect(parsePairing('mirror')).toBe('mirror')
    expect(() => parsePairing('random')).toThrow(/random/)
  })
})

describe('matchupFor', () => {
  it('mirror: game i seats factions[i % n] on both sides, so the faction draw decides nothing', () => {
    const fs = ['DWG', 'SS', 'WF'] as const
    expect(matchupFor(fs, 0, 'mirror')).toEqual({ factionA: 'DWG', factionB: 'DWG' })
    expect(matchupFor(fs, 1, 'mirror')).toEqual({ factionA: 'SS', factionB: 'SS' })
    expect(matchupFor(fs, 2, 'mirror')).toEqual({ factionA: 'WF', factionB: 'WF' })
    expect(matchupFor(fs, 3, 'mirror')).toEqual({ factionA: 'DWG', factionB: 'DWG' })
    expect(matchupFor(['WF'], 5, 'mirror')).toEqual({ factionA: 'WF', factionB: 'WF' })
  })
  it('cross: rotates the list one seat apart, so over a cycle each faction meets every other from both seats', () => {
    const fs = ['DWG', 'SS', 'WF'] as const
    expect(matchupFor(fs, 0, 'cross')).toEqual({ factionA: 'DWG', factionB: 'SS' })
    expect(matchupFor(fs, 1, 'cross')).toEqual({ factionA: 'SS', factionB: 'WF' })
    expect(matchupFor(fs, 2, 'cross')).toEqual({ factionA: 'WF', factionB: 'DWG' })
    expect(matchupFor(fs, 3, 'cross')).toEqual({ factionA: 'DWG', factionB: 'SS' })
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) { const m = matchupFor(fs, i, 'cross'); expect(m.factionA).not.toBe(m.factionB); seen.add(`${m.factionA}>${m.factionB}`) }
    expect(seen.size).toBe(3)   // three ordered pairs; the eval's seat alternation supplies the other three
  })
})
