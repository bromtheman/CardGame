import { describe, expect, it } from 'vitest'
import {
  FAN_FLOOR, HAND_RAIL_BUDGET_PX, HAND_RAIL_H, MAX_ANGLE_DEG, MAX_ARC_DROP, MAX_STEP_RATIO,
  RENDERED_CARD_H, RENDERED_CARD_W, ROTATION_BULGE,
  WRAPPER_INSET, fanLayout, fanSpan, fanStep,
} from './handFanLayout'

const WIDTH = 1104 // max-w-6xl (1152) minus the page's px-6 padding

describe('fanStep', () => {
  it('is zero for an empty or single-card hand', () => {
    expect(fanStep(0, WIDTH)).toBe(0)
    expect(fanStep(1, WIDTH)).toBe(0)
  })
  it('caps the spread on a small hand so it stays a fan, not a spaced-out row', () => {
    // Derived, not a literal: this assertion is about WHICH of the two terms
    // wins, and a hardcoded px figure silently stops testing that the moment
    // REST_SCALE moves.
    const share = (WIDTH - RENDERED_CARD_W) / 4
    expect(MAX_STEP_RATIO * RENDERED_CARD_W).toBeLessThan(share)
    expect(fanStep(5, WIDTH)).toBeCloseTo(MAX_STEP_RATIO * RENDERED_CARD_W, 5)
  })
  it('compresses a large hand to exactly fill the container', () => {
    expect(fanStep(12, WIDTH)).toBeCloseTo((WIDTH - RENDERED_CARD_W) / 11, 5)
  })
})

describe('the fan stays inside its box at any hand size', () => {
  // The page no longer scrolls, so an unbounded fan does not just look
  // dramatic — it overflows <main>, and a scrollable <main> lets a focused
  // card carry the command strip off the top of the screen.
  const SIZES = [1, 2, 5, 8, 12, 20, 40]

  it('never tilts a card past the sweep cap', () => {
    for (const n of SIZES) {
      for (const s of fanLayout(n, WIDTH)) {
        expect(Math.abs(s.angleDeg)).toBeLessThanOrEqual(MAX_ANGLE_DEG)
      }
    }
  })
  it('never drops a card past the arc cap', () => {
    for (const n of SIZES) {
      for (const s of fanLayout(n, WIDTH)) {
        expect(s.arcY).toBeLessThanOrEqual(MAX_ARC_DROP)
      }
    }
  })
  it('keeps every card clear of the rail floor, bulge included', () => {
    // A card rotated about its bottom centre dips ROTATION_BULGE below its own
    // bottom edge; `bottom` must leave at least that much beneath it.
    for (const n of SIZES) {
      for (const s of fanLayout(n, WIDTH)) {
        expect(s.bottom).toBeGreaterThanOrEqual(ROTATION_BULGE)
      }
    }
  })
  it('keeps the tallest card inside the rail', () => {
    for (const n of SIZES) {
      for (const s of fanLayout(n, WIDTH)) {
        expect(s.bottom + RENDERED_CARD_H).toBeLessThanOrEqual(HAND_RAIL_H)
      }
    }
  })
})

describe('the hand rail', () => {
  // The vertical half of "the hand fits on screen"; fanSpan below is the
  // horizontal half. laneLayout.test.ts holds the board to the same kind of
  // budget — between them, the battle screen fits one viewport by arithmetic
  // rather than by having been eyeballed once.
  it('rests inside the one-screen budget', () => {
    expect(HAND_RAIL_H).toBeLessThanOrEqual(HAND_RAIL_BUDGET_PX)
  })
})

describe('fanSpan', () => {
  it('never exceeds the container width at any hand size', () => {
    for (const n of [1, 2, 3, 5, 8, 12, 20]) {
      expect(fanSpan(n, WIDTH)).toBeLessThanOrEqual(WIDTH + 0.001)
    }
  })
  it('is a single card wide for a one-card hand', () => {
    expect(fanSpan(1, WIDTH)).toBeCloseTo(RENDERED_CARD_W, 5)
  })
  it('cannot shrink below one card even in an impossibly narrow container', () => {
    expect(fanSpan(5, 50)).toBeCloseTo(RENDERED_CARD_W, 5)
  })
})

describe('fanLayout', () => {
  it('returns nothing for an empty hand', () => {
    expect(fanLayout(0, WIDTH)).toEqual([])
  })
  it('centres a single card flat, with no rotation or arc drop', () => {
    // Rendered left edge sits at half the leftover width; the wrapper is the
    // inset further left because it is a full CARD_W box scaled about its
    // bottom centre.
    const expectedLeft = (WIDTH - RENDERED_CARD_W) / 2 - WRAPPER_INSET
    // No arc drop, so it rests at the fan's full floor.
    expect(fanLayout(1, WIDTH)).toEqual([{ left: expectedLeft, angleDeg: 0, arcY: 0, bottom: FAN_FLOOR }])
  })
  it('advances left monotonically', () => {
    const slots = fanLayout(7, WIDTH)
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].left).toBeGreaterThan(slots[i - 1].left)
    }
  })
  it('fans symmetrically about the centre', () => {
    const slots = fanLayout(5, WIDTH)
    expect(slots[0].angleDeg).toBeCloseTo(-slots[4].angleDeg, 5)
    expect(slots[1].angleDeg).toBeCloseTo(-slots[3].angleDeg, 5)
    expect(slots[2].angleDeg).toBeCloseTo(0, 5)
  })
  it('drops the outer cards further than the inner ones', () => {
    const slots = fanLayout(5, WIDTH)
    expect(slots[0].arcY).toBeGreaterThan(slots[1].arcY)
    expect(slots[2].arcY).toBeCloseTo(0, 5)
    expect(slots[0].arcY).toBeCloseTo(slots[4].arcY, 5)
  })
  it('centres the fan, leaving equal slack on both sides at any hand size', () => {
    for (const n of [1, 2, 3, 5, 8, 12]) {
      const slots = fanLayout(n, WIDTH)
      // slot.left is the WRAPPER's left; the rendered card starts an inset further right.
      const renderedLeft = slots[0].left + WRAPPER_INSET
      const renderedRight = slots[n - 1].left + WRAPPER_INSET + RENDERED_CARD_W
      expect(renderedLeft).toBeCloseTo(WIDTH - renderedRight, 5)
    }
  })
  it('never pushes cards off the left edge in an impossibly narrow container', () => {
    expect(fanLayout(5, 50)[0].left + WRAPPER_INSET).toBe(0)
  })
})
