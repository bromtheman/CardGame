import {
  CUSTOM_CARD_ROUND_TO, KEYWORDS, MAX_CUSTOM_BLUEPRINT_COST, VEHICLE_TYPES,
} from './gameSettings.ts'
import type { VehicleType } from './types.ts'

export function roundUpCost(blueprintCost: number): number {
  return Math.ceil(blueprintCost / CUSTOM_CARD_ROUND_TO) * CUSTOM_CARD_ROUND_TO
}

// Spec §3.10: round up to 5k first, then Half-Cost halves it for planes.
export function computeMaterialCost(blueprintCost: number, vehicleType: VehicleType): number {
  const rounded = roundUpCost(blueprintCost)
  return vehicleType === VEHICLE_TYPES.PLANE ? Math.floor(rounded / 2) : rounded
}

export function autoKeywords(vehicleType: VehicleType): string[] {
  if (vehicleType === VEHICLE_TYPES.PLANE) return [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY]
  if (vehicleType === VEHICLE_TYPES.AIRSHIP) return [KEYWORDS.FRAGILE]
  return []
}

export function validateCustomCardInput(input: {
  name: string
  vehicleType: string
  blueprintCost: number
}): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  if (name.length < 1 || name.length > 40) {
    errors.push('Name must be 1-40 characters')
  }
  if (!Object.values(VEHICLE_TYPES).includes(input.vehicleType as VehicleType)) {
    errors.push('Unknown vehicle type')
  }
  if (
    !Number.isInteger(input.blueprintCost) ||
    input.blueprintCost < 1 ||
    input.blueprintCost > MAX_CUSTOM_BLUEPRINT_COST
  ) {
    errors.push(`Blueprint cost must be a whole number between 1 and ${MAX_CUSTOM_BLUEPRINT_COST}`)
  }
  return errors
}
