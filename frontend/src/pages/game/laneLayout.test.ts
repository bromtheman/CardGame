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
  it('reserves the whole cap even when the lane is empty', () => {
    expect(laneRowsAt(PANEL_INNER, 0, MAX_VEHICLES_PER_ZONE_SIDE))
      .toBe(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE))
  })

  it('lays the full cap out in two rows at a real panel width', () => {
    expect(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE)).toBe(2)
  })

  it('grows a row rather than dropping a hull when a side sits above the cap', () => {
    expect(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE + 1, MAX_VEHICLES_PER_ZONE_SIDE)).toBe(3)
  })

  // Spec §4.1: the grid must render the REDUCED slot count or the board lies
  // about capacity. A denied lane reserves five slots, not eight. At the
  // FULL-width panel (4 columns) that difference is invisible in row count —
  // ceil(5/4) and ceil(8/4) both round up to 2 — so this uses the NARROW panel
  // (2 columns) instead, where the reduced cap (5 → 3 rows) and the flat
  // constant (8 → 4 rows) diverge: a `laneRowsAt` still reading the flat
  // constant fails this at 4, not 3.
  it('reserves only the reduced cap when a denier has shrunk it', () => {
    expect(laneRowsAt(NARROW_PANEL_INNER, 0, MAX_VEHICLES_PER_ZONE_SIDE - 3)).toBe(3)
  })

  // The over-cap case AND the denied case at once — the board a player actually
  // sees the turn a Tiger Shark lands opposite a full lane. This is an
  // INVARIANT pin, not a discriminator: `count` (8) already exceeds the
  // reduced cap (5), so `Math.max(count, cap)` picks `count` regardless of
  // which cap arrives, and this would pass unchanged even against the old
  // flat-constant implementation. It still matters — it pins that an
  // over-cap lane keeps showing every hull once a denier is on the board —
  // just not as proof the cap argument is wired through.
  it('still shows every hull of a lane that is over the reduced cap', () => {
    expect(laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE - 3)).toBe(2)
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
    expect(laneHeightAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE)).toBeLessThanOrEqual(LANE_HEIGHT_BUDGET_PX)
  })
  it('is the same height empty as it is full', () => {
    expect(laneHeightAt(PANEL_INNER, 0, MAX_VEHICLES_PER_ZONE_SIDE)).toBe(laneHeightAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE))
  })
  it('is a whole number of slot rows plus the gaps between them', () => {
    const rows = laneRowsAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE)
    expect(laneHeightAt(PANEL_INNER, MAX_VEHICLES_PER_ZONE_SIDE, MAX_VEHICLES_PER_ZONE_SIDE)).toBeGreaterThanOrEqual(rows * SLOT_HEIGHT_PX)
  })
})
