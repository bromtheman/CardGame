// Geometry for a zone's vehicle lanes, shared by BoardZone (which draws the
// grid and the empty slots) and MiniVehicle (which fills one). One module so
// the chip and the slot it sits in cannot drift apart — if they disagree the
// grid stops being fixed-height, which is the whole point of it.
//
// Tailwind v4 scans source files for class-name literals, so these must stay
// written out in full ('h-24', not a computed string) to survive the build.
// Each class has a _PX twin below because the one-screen budget is arithmetic
// and arithmetic needs numbers; laneLayout.test.ts is what holds the two in
// step, so change a class and its twin together.

import { MAX_VEHICLES_PER_ZONE_SIDE } from '@shared/gameSettings'

// Tall enough for the tallest chip content: p-1 (8) + icon h-6 (24) + name
// (4 + 16) + cost pill (16) + the fixed keyword row (2 + 16) = 86 of 96. It
// was h-28, which put a full-cap lane 28px over LANE_HEIGHT_BUDGET_PX and the
// player's hand below the fold. The 16px came off the icon and the line
// boxes, so the chip still carries name, cost AND keywords.
export const SLOT_HEIGHT_CLASS = 'h-24'
export const SLOT_HEIGHT_PX = 96

// One slot is exactly as wide as a MiniVehicle (w-20 = 5rem = 80px).
export const SLOT_WIDTH_CLASS = 'w-20'
export const SLOT_WIDTH_PX = 80

// gap-x-0.5 / gap-y-1 on the lane grid. The column gap is deliberately the
// smaller of the two: four 5rem tracks plus three 4px gaps come to 332px
// against a zone panel only a shade wider, so a 4px column gap loses the
// fourth column to a fraction of a pixel and makes the lane half a row taller
// for nothing. Rows keep the 4px — they need the separation, columns have the
// chips' own borders.
export const LANE_COL_GAP_PX = 2
export const LANE_ROW_GAP_PX = 4

// `auto-fill` rather than a fixed `repeat(4, …)`: the board is a 3-column grid
// from the md breakpoint up, so a zone panel is only ~213px wide at 768px of
// viewport and ~341px at 1152. Four hard columns fit the wide case and blow
// out the narrow one — the columns shrink but MiniVehicle is `w-20 shrink-0`,
// so the chips overflowed the panel and gave the whole PAGE a horizontal
// scrollbar.
//
// Letting the column count follow the available width keeps the lane inside
// its panel at every size. The row count then varies by viewport (4 columns
// at 1152, 2 at 768) — which is fine and is NOT the height instability this
// grid exists to prevent: what must not change is the height for a given
// width as vehicles come and go, and reserving all MAX_VEHICLES_PER_ZONE_SIDE
// slots regardless of occupancy is what secures that.
export const LANE_GRID_COLUMNS = 'repeat(auto-fill, 5rem)'

// What one lane may cost the board if the whole battle screen is to fit a
// single viewport. At 950px (a maximized browser on a 1080p screen) the fixed
// chrome — command strip, hero powers, hand rail, page padding — leaves the
// board box roughly 530px. About 130px of that is the zone panel's own chrome
// (title row, two HP bars, the front line, padding and gaps), leaving this for
// each of the two lanes. A chip tall enough to bust this budget is what pushed
// the player's hand below the fold before the viewport-fit pass.
export const LANE_HEIGHT_BUDGET_PX = 200

/** How many 5rem tracks `auto-fill` lays across a lane of this inner width. */
export function laneColumnsAt(innerWidth: number): number {
  // n tracks need n·80 + (n−1)·2 ≤ innerWidth. Never fewer than one, so an
  // absurdly narrow panel still renders a lane instead of dividing by zero.
  return Math.max(1, Math.floor((innerWidth + LANE_COL_GAP_PX) / (SLOT_WIDTH_PX + LANE_COL_GAP_PX)))
}

/**
 * Rows the lane occupies. `count` is the side's actual occupancy, but the cap
 * is always reserved — that is what keeps the lane the same height empty as
 * full. A side CAN sit above the cap (spawns, revives and Boarding Party
 * bypass it deliberately), and then the grid grows a row rather than dropping
 * a hull.
 */
export function laneRowsAt(innerWidth: number, count: number): number {
  const slots = Math.max(count, MAX_VEHICLES_PER_ZONE_SIDE)
  return Math.ceil(slots / laneColumnsAt(innerWidth))
}

/** Rendered height of one lane, in px. */
export function laneHeightAt(innerWidth: number, count: number): number {
  const rows = laneRowsAt(innerWidth, count)
  return rows * SLOT_HEIGHT_PX + (rows - 1) * LANE_ROW_GAP_PX
}
