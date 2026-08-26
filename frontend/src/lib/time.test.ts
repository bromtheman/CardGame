import { describe, expect, it } from 'vitest'
import { timeAgo } from './time'

describe('timeAgo', () => {
  const now = new Date('2026-08-25T12:00:00Z').getTime()
  it('buckets seconds, minutes, hours, days', () => {
    expect(timeAgo('2026-08-25T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-08-25T11:45:00Z', now)).toBe('15m ago')
    expect(timeAgo('2026-08-25T07:00:00Z', now)).toBe('5h ago')
    expect(timeAgo('2026-08-22T12:00:00Z', now)).toBe('3d ago')
  })
})
