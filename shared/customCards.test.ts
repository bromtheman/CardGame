import { describe, expect, it } from 'vitest'
import {
  autoKeywords, computeMaterialCost, roundUpCost, validateCustomCardInput,
} from './customCards'

describe('roundUpCost', () => {
  it('rounds up to nearest 5k', () => {
    expect(roundUpCost(40205)).toBe(45000)
    expect(roundUpCost(45000)).toBe(45000)
    expect(roundUpCost(1)).toBe(5000)
  })
})

describe('computeMaterialCost', () => {
  it('is the rounded cost for non-planes', () => {
    expect(computeMaterialCost(40205, 'ship')).toBe(45000)
    expect(computeMaterialCost(40205, 'airship')).toBe(45000)
  })
  it('does NOT pre-halve planes — Half-Cost is applied by the engine at play time (spec §3.7)', () => {
    expect(computeMaterialCost(40205, 'plane')).toBe(45000)
    expect(computeMaterialCost(5000, 'plane')).toBe(5000)
  })
})

describe('autoKeywords', () => {
  it('plane -> halfCost + temporary; airship -> fragile; others none', () => {
    expect(autoKeywords('plane')).toEqual(['halfCost', 'temporary'])
    expect(autoKeywords('airship')).toEqual(['fragile'])
    expect(autoKeywords('ship')).toEqual([])
    expect(autoKeywords('tank')).toEqual([])
    expect(autoKeywords('sub')).toEqual([])
  })
})

describe('validateCustomCardInput', () => {
  const good = { name: 'My Gunboat', vehicleType: 'ship', blueprintCost: 42000 }
  it('accepts a valid input', () => {
    expect(validateCustomCardInput(good)).toEqual([])
  })
  it('rejects bad name, type, and cost', () => {
    expect(validateCustomCardInput({ ...good, name: '' })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, name: 'x'.repeat(41) })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, vehicleType: 'boat' })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, blueprintCost: 0 })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, blueprintCost: 1.5 })).not.toEqual([])
    expect(validateCustomCardInput({ ...good, blueprintCost: 10_000_001 })).not.toEqual([])
  })
})
