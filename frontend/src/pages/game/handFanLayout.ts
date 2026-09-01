// Pure geometry for the fanned hand. No React, no DOM — so the maths that
// decides whether the hand fits on screen is unit-testable on its own.
//
// The original bug this replaces: cards were laid out in a flex row at
// `scale-75`, but `scale` is a transform — it shrinks a card visually while
// its layout box stays CARD_W wide. Four cards filled the container and the
// hand scrolled from the opening draw of five.

export const CARD_W = 280 // PhysicalCard's intrinsic size
export const CARD_H = 430

// Resting size of a card in the fan. It was 0.75, which made the hand rail
// 338px and — with the old header, the old chips and a permanent battle log —
// pushed the hand off the bottom of a 1080p screen. Only the RESTING size
// shrank: a lifted card still scales to a full 1.0 and rises over the board,
// so nothing is less readable at the moment a player is actually reading it.
export const REST_SCALE = 0.62
export const MAX_STEP_RATIO = 0.55 // cap on spread, so a small hand stays a fan
export const DEG_PER_CARD = 4 // ~20° total sweep across five cards
export const ARC_K = 1.6 // px of vertical drop per squared step from centre

// Both the sweep and the arc grow with hand size — the arc QUADRATICALLY — and
// an 18-card hand ran them to ±34° and a 116px drop. On the old scrolling page
// that merely looked dramatic; on a fixed-viewport board it pushed the outer
// cards off the bottom of the screen. Worse, it made the page's own <main>
// overflow, and an overflow-hidden box is still SCROLLABLE: focusing a hand
// card scrolled the command strip off the top with no way to bring it back.
//
// Capping both makes the fan's box bounded at every hand size, which is what
// lets the rail reserve a fixed height for it.
export const MAX_ANGLE_DEG = 12
export const MAX_ARC_DROP = 12
// No lift translation constant on purpose: the hovered card rises by scaling
// about `bottom center`, never by moving. A translate would slide the card's
// bottom edge out from under a cursor hovering there, and the resulting
// enter/leave loop made overlapping cards flicker between each other.

export const RENDERED_CARD_W = CARD_W * REST_SCALE // 173.6
export const RENDERED_CARD_H = CARD_H * REST_SCALE // 266.6

// A card is rotated about its BOTTOM CENTRE, which swings its lower corner
// below that edge by half the card's width times sin(angle). The rail has to
// reserve that, or the outermost cards are clipped by the bottom of the screen.
export const ROTATION_BULGE = Math.ceil((RENDERED_CARD_W / 2) * Math.sin((MAX_ANGLE_DEG * Math.PI) / 180))

/**
 * Height reserved beneath the highest card's bottom edge: the arc drop plus
 * the rotation bulge. Cards are positioned at `FAN_FLOOR - arcY`, so the
 * lowest card still clears the rail's bottom by ROTATION_BULGE.
 */
export const FAN_FLOOR = ROTATION_BULGE + MAX_ARC_DROP

/** Padding the hand rail adds above the resting fan. */
export const HAND_RAIL_PADDING = 4

/**
 * What the hand rail may cost the battle screen if the whole thing is to fit
 * one viewport. At 950px (a maximized browser on a 1080p screen) the command
 * strip, hero powers and page padding take ~124px and the board needs ~530 to
 * show three zone panels whole — which leaves this for the hand. The board is
 * the flexible row, so busting this budget no longer hides the hand; it eats
 * the board's height instead. Keeping to it is what stops that happening.
 * The lane's equivalent is laneLayout's LANE_HEIGHT_BUDGET_PX.
 */
export const HAND_RAIL_BUDGET_PX = 310

/** Rendered height of the hand rail: the fan's full box, arc and bulge included. */
export const HAND_RAIL_H = RENDERED_CARD_H + FAN_FLOOR + HAND_RAIL_PADDING

// A card's wrapper is a full CARD_W box scaled about `bottom center`, so the
// rendered card sits this far inside it. Wrapper positions subtract the inset
// so the *rendered* left edge lands where the fan maths intends.
export const WRAPPER_INSET = (CARD_W - RENDERED_CARD_W) / 2 // 35

export interface FanSlot {
  /** CSS `left` for the card's wrapper (already inset-corrected). */
  left: number
  /** Resting rotation in degrees; the lifted card overrides this to 0. */
  angleDeg: number
  /** Downward offset in px, so the fan curves at its edges. Capped. */
  arcY: number
  /** CSS `bottom` for the card's wrapper, measured from the rail's floor. */
  bottom: number
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
    const angleDeg = Math.sign(offset) * Math.min(Math.abs(offset) * DEG_PER_CARD, MAX_ANGLE_DEG)
    const arcY = Math.min(offset * offset * ARC_K, MAX_ARC_DROP)
    slots.push({
      left: originX + i * step - WRAPPER_INSET,
      angleDeg,
      arcY,
      // Measured UP from the rail's floor rather than down from its baseline:
      // the old `bottom: -arcY` hung the outer cards below the container, which
      // on a fixed-height page means below the bottom of the screen.
      bottom: FAN_FLOOR - arcY,
    })
  }
  return slots
}
