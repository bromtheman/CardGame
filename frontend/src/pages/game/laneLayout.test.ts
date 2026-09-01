import { describe, expect, it } from 'vitest'
import { MAX_VEHICLES_PER_ZONE_SIDE } from '@shared/gameSettings'
import {
  LANE_HEIGHT_BUDGET_PX, SLOT_HEIGHT_PX, laneColumnsAt, laneHeightAt, laneRowsAt,
} from './laneLayout'

// The inner width of one zone panel at the page's widest layout. The board row
// is its own `mx-auto w-full max-w-6xl`, so it is a full 1152px; three columns
// with gap-4 (2 × 16) make each zone 373.3px wide; the panel's own p-2 (2 × 8)
// leaves this much for the lane grid itself.
const PANEL_INNER = (1152 - 32) / 3 - 16

// A zone panel at the narrow end of the 3-column board — roughly what the md
// breakpoint (768px, less the page's px-4) yields — where auto-fill drops to
// two columns.
const NARROW_PANEL_INNER = (768 - 32 - 32) / 3 - 16

describe('laneColumnsAt', () => {
  it('fits four slots across a full-width zone panel', () => {
    expect(laneColumnsAt(PANEL_INNER)).toBe(4)
  })
  it('drops to two on a narrow panel rather than overflowing it', () => {
    expect(laneColumnsAt(NARROW_PANEL_INNER)).toBe(2)
  })
  it('never reports zero columns, however impossibly narrow the panel', () => {
    expect(laneColumnsAt(10)).toBe(1)
  })
})

describe('laneRowsAt', () => {
  it('lays the full cap out in two rows on a full-width panel', () => {
    expect(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE)).toBe(2)
  })
  it('reserves the whole cap even for an empty lane, so the height cannot jump', () => {
    expect(laneRowsAt(PANEL_INNER, 0)).toBe(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE))
  })
  it('grows a row for an over-cap lane rather than dropping a hull', () => {
    // Spawns, revives and Boarding Party deliberately bypass the cap
    // (gameSettings.MAX_VEHICLES_PER_ZONE_SIDE), so a side can sit above it.
    expect(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE + 1)).toBe(3)
  })
})

describe('laneHeightAt', () => {
  // The constraint the whole one-screen board rests on. At a 950px viewport
  // (a maximized browser on a 1080p screen) the fixed chrome — command strip,
  // hero powers, hand rail, padding — leaves the board box roughly 530px, of
  // which ~130px is the zone panel's own chrome (title, two HP bars, the front
  // line, padding and gaps). That leaves LANE_HEIGHT_BUDGET_PX for each of the
  // two lanes. A chip tall enough to bust this budget is what pushed the hand
  // below the fold in the first place.
  it('keeps a full-cap lane inside the one-screen budget', () => {
    expect(laneHeightAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE)).toBeLessThanOrEqual(LANE_HEIGHT_BUDGET_PX)
  })
  it('is the same height empty as it is full', () => {
    expect(laneHeightAt(PANEL_INNER, 0)).toBe(laneHeightAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE))
  })
  it('is a whole number of slot rows plus the gaps between them', () => {
    const rows = laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE)
    expect(laneHeightAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE)).toBeGreaterThanOrEqual(rows * SLOT_HEIGHT_PX)
  })
})
