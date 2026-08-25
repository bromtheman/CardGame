import { describe, expect, it } from 'vitest'
import { shortHandNumber } from './format'

describe('shortHandNumber', () => {
  it('formats like the old FE', () => {
    expect(shortHandNumber(999)).toBe('999')
    expect(shortHandNumber(42_000)).toBe('42k')
    expect(shortHandNumber(45_500)).toBe('45.5k')
    expect(shortHandNumber(1_000_000)).toBe('1.00 M')
    expect(shortHandNumber(1_200_000)).toBe('1.20 M')
    expect(shortHandNumber(0)).toBe('0')
  })
})
