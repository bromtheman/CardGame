import { describe, expect, it } from 'vitest'
import { SECTION_MARKERS } from '@shared/ai/llm/sections'
import { formatTableTalk } from '@shared/ai/llm/tableTalk'
import { latestTableTalk, tableTalkText } from './tableTalkDelta'

describe('latestTableTalk', () => {
  it('returns the newest table-talk line among the lines that arrived, unwrapped', () => {
    const prev = ['Turn 3 — player A to act']
    const next = [...prev, 'Corsair deployed', formatTableTalk('First'), 'Turn 3.5 — player B to act', formatTableTalk('Second')]
    expect(latestTableTalk(prev, next)).toBe('Second')
  })
  it('returns null when no table-talk arrived, even if older lines carry some', () => {
    const prev = [formatTableTalk('Old')]
    expect(latestTableTalk(prev, [...prev, 'Turn 4 — player A to act'])).toBeNull()
    expect(latestTableTalk(prev, prev)).toBeNull()
  })
  it('unwraps the prefix and the quotes', () => {
    expect(tableTalkText(formatTableTalk('All hands'))).toBe('All hands')
  })
  it('prefers the newest spoken line over a section marker that arrived after it, and shows the marker when nothing was spoken', () => {
    const prev = ['Turn 3 — player A to act']
    const spoke = [...prev, 'Corsair deployed', formatTableTalk('Corsair, forward!'), SECTION_MARKERS.fight]
    expect(latestTableTalk(prev, spoke)).toBe('Corsair, forward!')
    const quiet = [...prev, SECTION_MARKERS.deploy]
    expect(latestTableTalk(prev, quiet)).toBe('deploying…')
    expect(latestTableTalk(prev, [...prev, SECTION_MARKERS.deploy, formatTableTalk('Steady.'), SECTION_MARKERS.finish])).toBe('Steady.')
  })
})
