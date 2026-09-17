import { describe, expect, it } from 'vitest'
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
})
