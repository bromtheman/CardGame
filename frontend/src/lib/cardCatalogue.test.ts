import { describe, expect, it } from 'vitest'
import { catalogueCards, type CatalogueCard } from './cardCatalogue'

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
