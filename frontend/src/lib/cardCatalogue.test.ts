import { describe, expect, it } from 'vitest'
import { catalogueCards, catalogueTab, type CatalogueCard } from './cardCatalogue'

const card = (over: Partial<CatalogueCard>): CatalogueCard => ({
  is_built_in: true, faction: 'TG', meta: {}, ...over,
})

describe('catalogueCards', () => {
  // The 2026-09-02 pass retires cards by flag and keeps the rows seeded (spec
  // §2.1), so the catalogue has to exclude them itself — nothing upstream does.
  it('hides a retired built-in card from its faction tab', () => {
    const retired = card({ meta: { retired: true } })
    const live = card({})
    expect(catalogueCards([retired, live], 'TG')).toEqual([live])
  })

  it('only hides on the value true, not on the key being present', () => {
    const notRetired = card({ meta: { retired: false } })
    expect(catalogueCards([notRetired], 'TG')).toEqual([notRetired])
  })

  it('shows only the selected faction on a faction tab', () => {
    const tg = card({ faction: 'TG' })
    const ow = card({ faction: 'OW' })
    expect(catalogueCards([tg, ow], 'OW')).toEqual([ow])
  })

  it('shows only custom cards on the CUSTOM tab', () => {
    const custom = card({ is_built_in: false, faction: 'OW' })
    const builtIn = card({ faction: 'OW' })
    expect(catalogueCards([custom, builtIn], 'CUSTOM')).toEqual([custom])
  })

  it('tolerates a card with no meta object', () => {
    const bare = card({ meta: null })
    expect(catalogueCards([bare], 'TG')).toEqual([bare])
  })

  it('shows nothing when no tab is selected', () => {
    expect(catalogueCards([card({})], null)).toEqual([])
  })
})

describe('catalogueTab', () => {
  // Sorted as the page sorts them, so DWG is the tab a bare /cards opens on.
  const factions = ['DWG', 'GT', 'LH', 'OW', 'SS', 'TG', 'WF']

  it('opens the faction named in the URL, so a refresh keeps it', () => {
    expect(catalogueTab('SS', factions)).toBe('SS')
  })

  it('reads a hand-typed faction regardless of case', () => {
    expect(catalogueTab('ss', factions)).toBe('SS')
  })

  it('opens the CUSTOM tab, which is not in the faction list', () => {
    expect(catalogueTab('CUSTOM', factions)).toBe('CUSTOM')
  })

  it('falls back to the first faction when the URL names none', () => {
    expect(catalogueTab(null, factions)).toBe('DWG')
  })

  it('falls back to the first faction on a value that is no tab', () => {
    expect(catalogueTab('XYZ', factions)).toBe('DWG')
  })
})
