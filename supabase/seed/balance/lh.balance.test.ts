import { describe, expect, it } from 'vitest'
import { loadSeedData } from '../transform'
import type { SeedCard } from '../../../shared/types'

// The 2026-09-21 LH redesign, pinned against the seed source by VALUE — costs,
// keywords, texts, and every charge/gate/placement data key, because G1/G2/G3
// check names and presence, never numbers (docs/claude/card-effects.md).
// Numbers are spelled out, never derived.

async function bySeedKey(): Promise<Map<string, SeedCard>> {
  const { cards } = await loadSeedData()
  return new Map(cards.map((c) => [`${c.faction}:${c.name}`, c]))
}

interface Expected {
  materialCost: number
  blueprintCost: number
  cpCost: number
  keywords: string[]
  vehicleType: string | null
  cardText: string
  meta: Record<string, unknown>
}

export const CARDS: Record<string, Expected> = {
  'LH:Chrysoprase': {
    materialCost: 40_000, blueprintCost: 39_571, cpCost: 0, keywords: ['scrappy'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Dipole': {
    materialCost: 70_000, blueprintCost: 65_069, cpCost: 0, keywords: ['mobile'], vehicleType: 'airship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Watt': {
    materialCost: 90_000, blueprintCost: 90_797, cpCost: 0, keywords: ['scrappy', 'mobile', 'decoy'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 1 },
  },
  'LH:Luxon': {
    materialCost: 60_000, blueprintCost: 59_142, cpCost: 0, keywords: ['halfCost', 'temporary'], vehicleType: 'plane',
    cardText: 'Blind on its own: can only be played into a zone where you control an LH vehicle.',
    meta: { deployRequiresLhVehicle: true },
  },
  'LH:Conduit': {
    materialCost: 70_000, blueprintCost: 54_077, cpCost: 0, keywords: ['inoffensive', 'scrappy'], vehicleType: 'ship',
    cardText: 'Relay: at the start of your turn, other friendly LH vehicles in this zone gain 1 additional charge. This does not stack.',
    meta: { chargeRelay: 1 },
  },
  'LH:Byte': {
    materialCost: 40_000, blueprintCost: 43_301, cpCost: 0, keywords: ['mobile'], vehicleType: 'ship',
    cardText: 'Discharge 1: draw a card.',
    meta: { chargeMax: 1, onActivate: 'byteDraw', activateCpCost: 0, dischargeCost: 1 },
  },
  'LH:Volta': {
    materialCost: 40_000, blueprintCost: 37_207, cpCost: 0, keywords: ['fragile'], vehicleType: 'ship',
    cardText: 'When played, a friendly LH vehicle in this zone gains 1 charge.',
    meta: { chargeMax: 1, onPlayEffect: 'voltaJumpStart' },
  },
  'LH:Umbra': {
    materialCost: 150_000, blueprintCost: 148_479, cpCost: 0, keywords: ['stealthy'], vehicleType: 'sub',
    cardText: 'Discharge 2: deal 150k damage to the enemy base in this zone, then this surfaces — it loses Stealthy for the rest of the game.',
    meta: { chargeMax: 2, onActivate: 'umbraSalvo', activateCpCost: 0, dischargeCost: 2 },
  },
  'LH:Kilowatt': {
    materialCost: 180_000, blueprintCost: 180_583, cpCost: 0, keywords: ['blocker'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Caspian': {
    materialCost: 230_000, blueprintCost: 230_226, cpCost: 0, keywords: ['halfCost', 'temporary'], vehicleType: 'plane',
    cardText: 'Sea-skimmer: may be played into a zone with enemy Air Screen.', meta: { ignoresAirScreen: true },
  },
  'LH:Hydrovolt': {
    materialCost: 260_000, blueprintCost: 257_641, cpCost: 0, keywords: ['blocker', 'subScreen'], vehicleType: 'sub',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Dynamo': {
    materialCost: 350_000, blueprintCost: 346_346, cpCost: 0, keywords: ['mobile', 'swift'], vehicleType: 'airship',
    cardText: 'Requires 2 Charge.', meta: { chargeMax: 1, requiresCharge: 2 },
  },
  'LH:Megawatt': {
    materialCost: 360_000, blueprintCost: 361_751, cpCost: 0, keywords: ['mobile'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Ampere': {
    materialCost: 200_000, blueprintCost: 206_645, cpCost: 0, keywords: ['mobile'], vehicleType: 'ship',
    cardText: 'When played, stun target enemy vehicle in this zone.',
    meta: { chargeMax: 2, onPlayEffect: 'ampereStun' },
  },
  'LH:Eclipse': {
    materialCost: 220_000, blueprintCost: 215_980, cpCost: 0, keywords: ['stealthy'], vehicleType: 'ship',
    cardText: 'Discharge 2: this vehicle fights a 1v1 against target non-Stealthy enemy vehicle in this zone.',
    meta: { chargeMax: 2, onActivate: 'eclipseDuel', activateCpCost: 0, dischargeCost: 2 },
  },
  'LH:Penumbra': {
    materialCost: 370_000, blueprintCost: 375_279, cpCost: 0, keywords: [], vehicleType: 'ship',
    cardText: 'Discharge 3: stun every enemy vehicle in this zone.',
    meta: { chargeMax: 3, onActivate: 'penumbraPulse', activateCpCost: 0, dischargeCost: 3 },
  },
  'LH:Angstrom': {
    materialCost: 540_000, blueprintCost: 545_846, cpCost: 0, keywords: ['blocker', 'airScreen', 'mobile'], vehicleType: 'ship',
    cardText: '', meta: { chargeMax: 2 },
  },
  'LH:Quadrupole': {
    materialCost: 560_000, blueprintCost: 685_159, cpCost: 0, keywords: ['blocker', 'mobile'], vehicleType: 'airship',
    cardText: 'Requires 3 Charge.', meta: { chargeMax: 2, requiresCharge: 3 },
  },
  'LH:Candela': {
    materialCost: 700_000, blueprintCost: 1_021_169, cpCost: 0, keywords: ['blocker', 'subScreen', 'scrappy', 'mobile'], vehicleType: 'ship',
    cardText: 'Requires 4 Charge.', meta: { chargeMax: 2, requiresCharge: 4 },
  },
  'LH:Rectifier': {
    materialCost: 700_000, blueprintCost: 734_617, cpCost: 0, keywords: ['halfCost', 'temporary', 'fragile', 'swift'], vehicleType: 'plane',
    cardText: '', meta: {},
  },
  'LH:Cathode': {
    materialCost: 600_000, blueprintCost: 726_398, cpCost: 0, keywords: ['stealthy', 'subScreen'], vehicleType: 'sub',
    cardText: 'Requires 3 Charge. Discharge 2: this vehicle fights a 1v1 against target enemy ship or submarine in this zone, then this surfaces — it loses Stealthy for the rest of the game.',
    meta: { chargeMax: 2, requiresCharge: 3, onActivate: 'cathodeDuel', activateCpCost: 0, dischargeCost: 2 },
  },
  'LH:Superradiance': {
    materialCost: 620_000, blueprintCost: 625_766, cpCost: 0, keywords: [], vehicleType: 'ship',
    cardText: 'Discharge 3: deal 300k damage to the enemy base in this zone.',
    meta: { chargeMax: 3, onActivate: 'superradianceBeam', activateCpCost: 0, dischargeCost: 3 },
  },
  'LH:Impedance': {
    materialCost: 750_000, blueprintCost: 1_326_933, cpCost: 0, keywords: ['blocker'], vehicleType: 'ship',
    cardText: 'Requires 5 Charge. Discharge 2: deal 400k damage to the enemy base in this zone.',
    meta: { chargeMax: 2, requiresCharge: 5, onActivate: 'impedanceBeam', activateCpCost: 0, dischargeCost: 2 },
  },
  'LH:Terawatt': {
    materialCost: 640_000, blueprintCost: 725_002, cpCost: 0, keywords: ['blocker', 'scrappy', 'mobile'], vehicleType: 'ship',
    cardText: 'Requires 3 Charge. Generators: this gains 2 charge at the start of your turn instead of 1. Discharge 2: another friendly LH vehicle in this zone gains 2 charge.',
    meta: { chargeMax: 4, chargeRate: 2, requiresCharge: 3, onActivate: 'terawattTransfer', activateCpCost: 0, dischargeCost: 2 },
  },
  'LH:EMP Salvo': {
    materialCost: 60_000, blueprintCost: 0, cpCost: 0, keywords: [], vehicleType: null,
    cardText: 'Discharge 2 from a friendly LH vehicle: stun target enemy vehicle in that zone.',
    meta: { playOnVehicleEffect: 'empSalvoEffect', dischargeFrom: 2 },
  },
  'LH:Overcharge': {
    materialCost: 0, blueprintCost: 0, cpCost: 1, keywords: [], vehicleType: null,
    cardText: 'Target friendly LH vehicle gains 2 charge.',
    meta: { playOnVehicleEffect: 'overchargeEffect' },
  },
  'LH:Afterburner': {
    materialCost: 50_000, blueprintCost: 0, cpCost: 0, keywords: [], vehicleType: null,
    cardText: 'Discharge 2 from a friendly LH vehicle: a friendly LH vehicle played this turn in that zone may attack the base this turn.',
    meta: { playOnVehicleEffect: 'afterburnerEffect', dischargeFrom: 2 },
  },
  'LH:Extended Sortie': {
    materialCost: 100_000, blueprintCost: 0, cpCost: 0, keywords: [], vehicleType: null,
    cardText: 'Discharge 2 from a friendly LH vehicle: a friendly LH plane in that zone loses Temporary.',
    meta: { playOnVehicleEffect: 'extendedSortieEffect', dischargeFrom: 2 },
  },
}

// Retired by this wave (spec §7): rows stay seeded, undraftable.
export const RETIRED = [
  'LH:Coulomb', 'LH:Thunderbird', 'LH:Sapphire', 'LH:Sapphire Screen', 'LH:Spectrum',
  'LH:Orbit', 'LH:Orbit Flank', 'LH:Robotic Assemblers',
  'TG:[TG] Amusement', 'TG:[TG] Fear', 'TG:[TG] Hysteria', 'TG:[TG] Obsession',
]

describe('LH redesign — rows by value', () => {
  it.each(Object.entries(CARDS))('%s', async (k, want) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} is missing from the seed source`).toBeDefined()
    expect({
      materialCost: card!.materialCost, blueprintCost: card!.blueprintCost, cpCost: card!.cpCost,
      keywords: [...(card!.keywords ?? [])].sort(), vehicleType: card!.vehicleType ?? null,
      cardText: card!.cardText ?? '',
    }).toEqual({
      materialCost: want.materialCost, blueprintCost: want.blueprintCost, cpCost: want.cpCost,
      keywords: [...want.keywords].sort(), vehicleType: want.vehicleType, cardText: want.cardText,
    })
    // Every data key by VALUE; unlisted engine-facing keys must be absent so a
    // stray gate or price cannot ride in unpinned.
    const meta = (card!.meta ?? {}) as Record<string, unknown>
    for (const [key, value] of Object.entries(want.meta)) expect(meta[key], `${k}.meta.${key}`).toEqual(value)
    for (const key of ['chargeMax', 'chargeRate', 'chargeRelay', 'dischargeCost', 'dischargeFrom', 'requiresCharge', 'deployRequiresLhVehicle', 'ignoresAirScreen', 'activateCpCost']) {
      if (!(key in want.meta)) expect(meta[key], `${k}.meta.${key} should be absent`).toBeUndefined()
    }
    expect(meta.retired, `${k} must not be retired`).not.toBe(true)
  })

  it.each(RETIRED)('%s is retired and still seeded', async (k) => {
    const card = (await bySeedKey()).get(k)
    expect(card, `${k} must stay seeded for in-flight games`).toBeDefined()
    expect((card!.meta as Record<string, unknown>).retired).toBe(true)
  })
})
