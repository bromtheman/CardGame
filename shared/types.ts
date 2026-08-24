import type { CARD_TYPES, FACTIONS, VEHICLE_TYPES, ZONE_TYPES } from './gameSettings'

export type Faction = (typeof FACTIONS)[keyof typeof FACTIONS]
export type CardType = (typeof CARD_TYPES)[keyof typeof CARD_TYPES]
export type VehicleType = (typeof VEHICLE_TYPES)[keyof typeof VEHICLE_TYPES]
export type ZoneType = (typeof ZONE_TYPES)[keyof typeof ZONE_TYPES]

// Shape of one card object in the old BE's builtInCards/*.js source files.
export interface SeedCard {
  name: string
  isBuiltIn: boolean
  cardText?: string
  materialCost: number
  blueprintCost: number
  cpCost: number
  imageUrl?: string
  playerId: string | null
  vehicleType: VehicleType | null
  type: CardType
  faction: Faction
  blueprintId: string | null
  keywords?: string[]
  meta?: Record<string, unknown>
}

// Shape of one entry in the old BE's heroPowers.js.
export interface SeedHeroPower {
  faction: Faction
  name: string
  text: string
  cpCost: number
}
