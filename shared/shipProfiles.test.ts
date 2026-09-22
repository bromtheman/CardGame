import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../supabase/seed/transform'
import { SHIP_PROFILES, shipProfileOf, shipProfilesForFaction } from './shipProfiles'

// The profiles are generated from FtDArmament's per-faction reports and keyed
// FACTION:Name — the same key the seed derives card ids from — so they are
// pinned to the seed the way the bot decks and the faction notes are: every
// key must be a seeded, draftable-or-summonable built-in VEHICLE spelled as
// the seed prints it, and every such vehicle of a profiled faction must have
// a profile, so a rename, a retirement or a new hull fails here rather than
// leaving a card without its glimpse.

describe('ship profiles', () => {
  it('looks a built-in card up by faction and name, and misses otherwise', () => {
    expect(shipProfileOf('DWG', 'Crossbones')?.role).toBe('CRAM battleship, flagship')
    expect(shipProfileOf('SS', 'Tyr')?.role).toBe('flagship battleship')
    expect(shipProfileOf('WF', 'Martyr')?.role).toBe('kamikaze nuke drone')
    expect(shipProfileOf('DWG', 'No Such Ship')).toBeNull()
    expect(shipProfileOf('OW', 'Crossbones')).toBeNull()
    expect(shipProfileOf('DWG', 'Tyr')).toBeNull()
  })

  it('lists one faction’s profiles in report order — cheapest first, except LH, which the report groups by type then name — by card name', () => {
    const dwg = shipProfilesForFaction('DWG')
    expect(dwg.map((p) => p.name).slice(0, 3)).toEqual(['Corsair', 'Marauder', 'Loggerhead'])
    expect(dwg.at(-1)?.name).toBe('Tarpon')
    const ss = shipProfilesForFaction('SS')
    expect(ss.map((p) => p.name).slice(0, 3)).toEqual(['Sacrilego', 'Resolute', 'Chrysaor'])
    expect(ss.at(-1)?.name).toBe('Tyr')
    expect(ss).toHaveLength(27)
    const wf = shipProfilesForFaction('WF')
    expect(wf.map((p) => p.name).slice(0, 3)).toEqual(['Martyr', 'Earth Raker', 'Buzzsaw'])
    expect(wf.at(-1)?.name).toBe('Purifier')
    const lh = shipProfilesForFaction('LH')
    expect(lh.map((p) => p.name).slice(0, 3)).toEqual(['Ampere', 'Angstrom', 'Byte'])
    expect(lh.at(-1)?.name).toBe('Quadrupole')
    expect(lh).toHaveLength(24)
    expect(shipProfilesForFaction('OW')).toEqual([])
  })

  it('keeps the report’s optional fields only where the report has them', () => {
    // Falcon Squadron is the one SS section with prose between its card table
    // and its ratings; three SS capital ships list an escort.
    expect(shipProfileOf('SS', 'Falcon Squadron')?.note).toBeTruthy()
    expect(shipProfileOf('SS', 'Tyr')?.note).toBeUndefined()
    expect(shipProfileOf('SS', 'Asphodel')?.escort).toBeTruthy()
    expect(shipProfileOf('SS', 'Sacrilego')?.escort).toBeUndefined()
  })

  it('flags the LH and WF craft FtD scores 0 as sharing their rank, and no other', () => {
    const tied = Object.entries(SHIP_PROFILES).filter(([, p]) => p.rankTied).map(([key]) => key)
    expect(tied).toEqual(['LH:Conduit', 'LH:Kilowatt', 'LH:Volta', 'WF:Martyr', 'WF:Earth Raker', 'WF:Pontus', 'WF:Pulverizer'])
    for (const key of tied) expect(SHIP_PROFILES[key].strength, key).toBe(0)
  })

  it('carries whole-number scores from one to five and non-empty prose', () => {
    for (const [key, p] of Object.entries(SHIP_PROFILES)) {
      for (const [k, r] of [...Object.entries(p.scores), ...Object.entries(p.matchups)]) {
        expect(Number.isInteger(r.score) && r.score >= 1 && r.score <= 5, `${key} ${k}`).toBe(true)
        expect(r.why, `${key} ${k} why`).not.toBe('')
      }
      for (const field of ['role', 'type', 'speed', 'fightsAt', 'sees', 'summary', 'verdict', 'verdictDetail'] as const) {
        expect(p[field], `${key} ${field}`).not.toBe('')
      }
    }
  })

  it('keys every profile to a seeded, non-retired built-in vehicle, spelled as the seed prints it', async () => {
    const { cards } = await loadSeedData()
    const byKey = new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
    for (const key of Object.keys(SHIP_PROFILES)) {
      const card = byKey.get(key)
      expect(card, `${key} is not a seeded card`).toBeDefined()
      expect(card!.type, `${key} is not a vehicle`).toBe('vehicle')
      expect(card!.isBuiltIn, `${key} is not built in`).toBe(true)
      expect((card!.meta as Record<string, unknown> | undefined)?.retired, `${key} is retired`).not.toBe(true)
    }
  })

  it('profiles every non-retired vehicle of a faction that has any profile', async () => {
    const { cards } = await loadSeedData()
    const factions = new Set(Object.keys(SHIP_PROFILES).map((k) => k.split(':')[0]))
    expect(factions.size).toBeGreaterThan(0)
    for (const card of cards) {
      if (!factions.has(card.faction) || card.type !== 'vehicle') continue
      if ((card.meta as Record<string, unknown> | undefined)?.retired === true) continue
      expect(shipProfileOf(card.faction, card.name), `${card.faction}:${card.name} has no ship profile`).not.toBeNull()
    }
  })
})
