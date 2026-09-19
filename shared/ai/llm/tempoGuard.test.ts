import { describe, expect, it } from 'vitest'
import type { MenuItem } from './moveMenu'
import { guardPick } from './tempoGuard'

const end: MenuItem = { id: 1, action: { type: 'END_TURN' }, text: 'end', section: 'finish', score: 0 }
const deploy: MenuItem = { id: 2, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 1 }, text: 'deploy', section: 'deploy', score: 2.5 }
const weak: MenuItem = { id: 3, action: { type: 'PLAY_CARD_TO_ZONE', instanceId: 'x', zoneId: 2 }, text: 'weak', section: 'deploy', score: 1.8 }
const menu = [end, deploy, weak]

describe('guardPick', () => {
  it('lets a pick within the margin stand', () => {
    expect(guardPick(menu, weak, 1)).toEqual({ item: weak, guard: null })
    expect(guardPick(menu, deploy, 1)).toEqual({ item: deploy, guard: null })
  })
  it('replaces a pick, a pass and END TURN that fall a margin or more below the best, recording the gap', () => {
    expect(guardPick(menu, end, 1)).toEqual({ item: deploy, guard: { picked: 1, taken: 2, gap: 2.5 } })
    expect(guardPick(menu, null, 1)).toEqual({ item: deploy, guard: { picked: null, taken: 2, gap: 2.5 } })
    expect(guardPick(menu, weak, 0.5)).toEqual({ item: deploy, guard: { picked: 3, taken: 2, gap: 0.7 } })
  })
  it('never guards at Infinity, and treats unscored items as zero', () => {
    expect(guardPick(menu, end, Infinity)).toEqual({ item: end, guard: null })
    expect(guardPick([end, { ...deploy, score: null }], null, 1)).toEqual({ item: null, guard: null })
  })
})
