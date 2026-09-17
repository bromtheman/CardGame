import { describe, expect, it } from 'vitest'
import { LOG_MAX_ENTRIES } from '../../gameSettings'
import { newLogLines } from './logDelta'

describe('newLogLines', () => {
  it('returns the appended lines when nothing was dropped', () => {
    expect(newLogLines(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'd'])
    expect(newLogLines([], ['a'])).toEqual(['a'])
    expect(newLogLines(['a'], ['a'])).toEqual([])
  })
  it('handles a repeated last line', () => {
    expect(newLogLines(['Hero Power Draw'], ['Hero Power Draw', 'Hero Power Draw'])).toEqual(['Hero Power Draw'])
  })
  it('aligns on the longest overlap once the cap dropped old lines', () => {
    const prev = Array.from({ length: LOG_MAX_ENTRIES }, (_, i) => `line ${i}`)
    const next = [...prev.slice(2), 'new 1', 'new 2']
    expect(newLogLines(prev, next)).toEqual(['new 1', 'new 2'])
  })
  it('treats a log with no overlap as entirely new', () => {
    expect(newLogLines(['x', 'y'], ['p', 'q'])).toEqual(['p', 'q'])
  })
})
