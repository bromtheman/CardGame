import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-02 balance pass — OW's share, pinned against the seed source.
//
// One file per faction so the five faction branches never edit the same test
// file (spec §2.3). Costs, keywords and card text are plain data that nothing
// else in the suite reads: effectCoverage asks only whether a card's EFFECTS
// are wired, and seedDataSync only whether the generated SQL matches its
// source. Both stay green if a number is fat-fingered. This file would not.
//
// Numbers are spelled out, never derived — a test that recomputes its
// expectation from the source it is checking proves nothing.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

interface Expected {
  materialCost: number
  blueprintCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
}

// Every OW card the pass touched, new or updated. Keywords are compared as
// sets — order in the seed literal is not meaningful. cardText and vehicleType
// are NOT optional here, unlike balancePass.test.ts's shape: this pass moves a
// card's text and a card's type, so leaving either unpinned would leave the
// wave's two least visible edits unguarded.
const CARDS: Record<string, Expected> = {
  'OW:Brandistock': {
    materialCost: 250_000, blueprintCost: 258_000, keywords: ['subScreen'],
    vehicleType: 'ship',
    cardText: 'When this card is destroyed, draw a random GT Airship',
  },
  'OW:Bulwark': {
    materialCost: 450_000, blueprintCost: 848_000, keywords: ['blocker'],
    vehicleType: 'ship', cardText: '',
  },
  'OW:The Onyx Throne': {
    materialCost: 500_000, blueprintCost: 492_482,
    keywords: ['blocker', 'inoffensive'], vehicleType: 'ship',
    cardText: 'Whenever this vehicle would partake in a defensive battle, spawn an allied parapet to fight alongside it. Once per turn, you may pay 1cp to draw a GT heavy airship card.',
  },
  // HALF_COST out, FRAGILE in — and this is a bigger swing than the material
  // cost suggests. effectiveMaterialCostOf halves a halfCost hull for damage,
  // repairs and in-battle resources, so Eyrie's effective price goes 390k
  // (half of 780k) to 575k while its sticker price falls. FRAGILE then blocks
  // repair outright. Recorded here because a reader checking only materialCost
  // would score this as a buff.
  'OW:Eyrie': {
    materialCost: 575_000, blueprintCost: 809_000,
    keywords: ['blocker', 'fragile'], vehicleType: 'airship', cardText: '',
  },
  // Rook's vehicleType is the only thing moving, and it moves from
  // transform.ts's patch table into the card. The assertion reads the same
  // either way — which is the point: the change is behaviour-free. What
  // catches a Rook that silently became typeless is transform.test.ts's
  // "every vehicle-type card has a non-null vehicleType".
  'OW:Rook': {
    materialCost: 50_000, blueprintCost: 98_841, keywords: [],
    vehicleType: 'airship', cardText: 'Draw a card when played',
  },
}

describe('2026-09-02 balance pass — OW', () => {
  it.each(Object.entries(CARDS))('%s carries its balanced numbers', async (k, want) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} is missing from the seed source`).toBeDefined()
    expect({
      materialCost: card!.materialCost,
      blueprintCost: card!.blueprintCost,
      keywords: [...(card!.keywords ?? [])].sort(),
      vehicleType: card!.vehicleType ?? null,
      cardText: card!.cardText ?? '',
    }).toEqual({
      materialCost: want.materialCost,
      blueprintCost: want.blueprintCost,
      keywords: [...want.keywords].sort(),
      vehicleType: want.vehicleType,
      cardText: want.cardText,
    })
  })

  // R-6, checked from the DATA end. The engine-side check (that both names are
  // registered) lives in factionEffects.test.ts; this one is what would catch
  // a seed edit that pointed Brandistock at Halberd's id — which compiles,
  // passes G1, and silently rebinds one of the two.
  it('Brandistock names its own death trigger, and Halberd keeps its own', async () => {
    const cards = await bySeedKey()
    expect(cards.get('OW:Brandistock')!.meta?.onDeathEffect).toBe('brandistockOnDeath')
    expect(cards.get('OW:Halberd')!.meta?.onDeathEffect).toBe('halberdOnDeath')
  })

  // The meta key's ABSENCE is the change, and an absence is exactly what no
  // guard checks: G2 stops looking once cardText is empty, and G1 has no name
  // left to resolve. Without this line, silently leaving onPlayEffect in place
  // would ship a card that still grants 2cp while printing nothing — the worst
  // shape of balance bug, because the board never explains itself.
  it('Bulwark carries no onPlayEffect any more — the 2cp is gone with the text', async () => {
    const bulwark = (await bySeedKey()).get('OW:Bulwark')!
    expect(bulwark.meta ?? {}).toEqual({})
  })

  // Both keys, or the card has a registered ability and no way to press it:
  // ACTIVATE_VEHICLE requires onActivate AND activateCpCost, and BoardZone
  // gates the board's "use" button on the same pair. A text-only edit is
  // exactly the change most likely to take a meta key with it by accident —
  // the 2026-08-30 pass did it to Braveheart.
  it('The Onyx Throne keeps both clauses its reworded text still promises', async () => {
    expect((await bySeedKey()).get('OW:The Onyx Throne')!.meta).toMatchObject({
      onBattleEffect: 'onyxThroneBattle',
      onActivate: 'onyxThroneActivate',
      activateCpCost: 1,
    })
  })
})
