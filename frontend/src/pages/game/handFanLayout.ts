// Pure geometry for the fanned hand. No React, no DOM — so the maths that
// decides whether the hand fits on screen is unit-testable on its own.
//
// The original bug this replaces: cards were laid out in a flex row at
// `scale-75`, but `scale` is a transform — it shrinks a card visually while
// its layout box stays CARD_W wide. Four cards filled the container and the
// hand scrolled from the opening draw of five.

export const CARD_W = 280 // PhysicalCard's intrinsic size
export const CARD_H = 430

export const REST_SCALE = 0.75 // resting size of a card in the fan
export const MAX_STEP_RATIO = 0.55 // cap on spread, so a small hand stays a fan
export const DEG_PER_CARD = 4 // ~20° total sweep across five cards
export const ARC_K = 1.6 // px of vertical drop per squared step from centre
// No lift translation constant on purpose: the hovered card rises by scaling
// about `bottom center`, never by moving. A translate would slide the card's
// bottom edge out from under a cursor hovering there, and the resulting
// enter/leave loop made overlapping cards flicker between each other.

export const RENDERED_CARD_W = CARD_W * REST_SCALE // 210
export const RENDERED_CARD_H = CARD_H * REST_SCALE // 322.5

// A card's wrapper is a full CARD_W box scaled about `bottom center`, so the
// rendered card sits this far inside it. Wrapper positions subtract the inset
// so the *rendered* left edge lands where the fan maths intends.
export const WRAPPER_INSET = (CARD_W - RENDERED_CARD_W) / 2 // 35

export interface FanSlot {
  /** CSS `left` for the card's wrapper (already inset-corrected). */
  left: number
  /** Resting rotation in degrees; the lifted card overrides this to 0. */
  angleDeg: number
  /** Downward offset in px, so the fan curves at its edges. */
  arcY: number
}

/** Horizontal advance between adjacent cards, in rendered pixels. */
export function fanStep(count: number, containerWidth: number): number {
  if (count <= 1) return 0
  const available = Math.max(0, containerWidth - RENDERED_CARD_W)
  return Math.min(MAX_STEP_RATIO * RENDERED_CARD_W, available / (count - 1))
}

/**
 * Rendered edge-to-edge width of the whole fan. This is the value that must
 * fit the container — NOT the sum of the wrapper boxes.
 */
export function fanSpan(count: number, containerWidth: number): number {
  if (count <= 0) return 0
  return fanStep(count, containerWidth) * (count - 1) + RENDERED_CARD_W
}

export function fanLayout(count: number, containerWidth: number): FanSlot[] {
  const step = fanStep(count, containerWidth)
  const centre = (count - 1) / 2
  // MAX_STEP_RATIO caps the spread, so a small hand does not fill the
  // container — centre the fan rather than left-aligning it, or every pixel
  // of slack piles up on the right and the hand reads as misaligned. Clamped
  // at 0 so a container narrower than one card never pushes cards off-screen.
  const originX = Math.max(0, (containerWidth - fanSpan(count, containerWidth)) / 2)
  const slots: FanSlot[] = []
  for (let i = 0; i < count; i++) {
    const offset = i - centre
    slots.push({
      left: originX + i * step - WRAPPER_INSET,
      angleDeg: offset * DEG_PER_CARD,
      arcY: offset * offset * ARC_K,
    })
  }
  return slots
}
