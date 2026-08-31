import { describe, expect, it } from 'vitest'
import type { ZoneEffect } from '@shared/engine/gameInit'
import { zoneEffectBadges } from './zoneEffectBadges'

const waters = (over: Partial<ZoneEffect> = {}): ZoneEffect => ({
  effect: 'dwgWatersEffect', zoneId: 1, side: 'a', cardName: 'DWG Waters', setOnTurn: 2, ...over,
})

describe('zoneEffectBadges', () => {
  it('returns a badge for a marker on the zone, flagged as mine for its owner', () => {
    const [badge, ...rest] = zoneEffectBadges([waters()], 1, 'a')
    expect(rest).toEqual([])
    expect(badge).toMatchObject({ icon: 'anchor', label: 'DWG Waters', mine: true })
    expect(badge.detail).toContain('Player A')
  })

  it('flags the opponent marker as not mine', () => {
    const [badge] = zoneEffectBadges([waters({ side: 'b' })], 1, 'a')
    expect(badge.mine).toBe(false)
    expect(badge.detail).toContain('Player B')
  })

  it('ignores markers belonging to other zones', () => {
    expect(zoneEffectBadges([waters({ zoneId: 2 })], 1, 'a')).toEqual([])
  })

  it('ignores effect names it has no display entry for', () => {
    expect(zoneEffectBadges([waters({ effect: 'someFutureZoneEffect' })], 1, 'a')).toEqual([])
  })

  it('gives each badge on a zone a distinct key', () => {
    const badges = zoneEffectBadges([waters(), waters({ side: 'b' })], 1, 'a')
    expect(new Set(badges.map((b) => b.key)).size).toBe(2)
  })

  // Wave 5: effect + side + zone is no longer unique. One player may plant
  // several Recurring Threats on one zone, each remembering a different hull.
  it('gives two identical markers on one zone distinct keys', () => {
    const threat = (): ZoneEffect => ({
      effect: 'recurringThreatEffect', zoneId: 1, side: 'a', cardName: 'Recurring Threat', setOnTurn: 2,
    })
    const badges = zoneEffectBadges([threat(), threat()], 1, 'a')
    expect(badges).toHaveLength(2)
    expect(new Set(badges.map((b) => b.key)).size).toBe(2)
  })

  it.each([
    ['ambushEffect', 'Ambush'],
    ['ongoingAttritionEffect', 'Ongoing Attrition'],
    ['subKillerEffect', 'Sub Killer'],
    ['recurringThreatEffect', 'Recurring Threat'],
  ])('renders a badge for %s', (effect, label) => {
    const [badge] = zoneEffectBadges([waters({ effect, cardName: label })], 1, 'a')
    expect(badge.label).toBe(label)
    expect(badge.detail).toContain('Player A')
  })

  it('tolerates state written before zoneEffects existed', () => {
    expect(zoneEffectBadges(undefined, 1, 'a')).toEqual([])
  })
})
