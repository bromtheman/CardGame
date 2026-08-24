import { describe, expect, it } from 'vitest'
import { isValidUsername } from './validation'

describe('isValidUsername', () => {
  it('accepts 3-20 chars of letters, digits, underscore', () => {
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('Sea_Dog_42')).toBe(true)
    expect(isValidUsername('a'.repeat(20))).toBe(true)
  })
  it('rejects too short, too long, bad chars', () => {
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('a'.repeat(21))).toBe(false)
    expect(isValidUsername('bad name')).toBe(false)
    expect(isValidUsername('bäd')).toBe(false)
    expect(isValidUsername('')).toBe(false)
  })
})
