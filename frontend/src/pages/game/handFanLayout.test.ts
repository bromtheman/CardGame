import { describe, expect, it } from 'vitest'
import {
  RENDERED_CARD_W, WRAPPER_INSET, fanLayout, fanSpan, fanStep,
} from './handFanLayout'

const WIDTH = 1104 // max-w-6xl (1152) minus the page's p-6 padding

describe('fanStep', () => {
  it('is zero for an empty or single-card hand', () => {
    expect(fanStep(0, WIDTH)).toBe(0)
    expect(fanStep(1, WIDTH)).toBe(0)
  })
  it('caps the spread on a small hand so it stays a fan, not a spaced-out row', () => {
    // (1104 - 210) / 4 = 223.5 available, but the ratio cap is 0.55 * 210
    expect(fanStep(5, WIDTH)).toBeCloseTo(115.5, 5)
  })
  it('compresses a large hand to exactly fill the container', () => {
    expect(fanStep(12, WIDTH)).toBeCloseTo((WIDTH - RENDERED_CARD_W) / 11, 5)
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
    expect(fanLayout(1, WIDTH)).toEqual([{ left: -WRAPPER_INSET, angleDeg: 0, arcY: 0 }])
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
  it('offsets every wrapper by the inset so rendered cards start at the container edge', () => {
    expect(fanLayout(4, WIDTH)[0].left).toBeCloseTo(-WRAPPER_INSET, 5)
  })
})
