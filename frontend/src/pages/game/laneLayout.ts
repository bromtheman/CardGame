// Geometry for a zone's vehicle lanes, shared by BoardZone (which draws the
// grid and the empty slots) and MiniVehicle (which fills one). One module so
// the chip and the slot it sits in cannot drift apart — if they disagree the
// grid stops being fixed-height, which is the whole point of it.
//
// Tailwind v4 scans source files for class-name literals, so these must stay
// written out in full ('h-28', not a computed string) to survive the build.

// Tall enough for the tallest chip content: p-1 (8) + icon h-8 (32) + name
// (24) + cost pill (~21) + the fixed keyword row (20) = ~105 of 112.
export const SLOT_HEIGHT_CLASS = 'h-28'

// One slot is exactly as wide as a MiniVehicle (w-20 = 5rem = 80px).
export const SLOT_WIDTH_CLASS = 'w-20'

// `auto-fill` rather than a fixed `repeat(4, …)`: the board is a 3-column grid
// from the md breakpoint up, so a zone panel is only ~240px wide at 820px of
// viewport and ~356px at 1440. Four hard columns fit the wide case and blow
// out the narrow one — the columns shrink but MiniVehicle is `w-20 shrink-0`,
// so the chips overflowed the panel and gave the whole PAGE a horizontal
// scrollbar.
//
// Letting the column count follow the available width keeps the lane inside
// its panel at every size. The row count then varies by viewport (4 columns
// at 1440, 2 at 820) — which is fine and is NOT the height instability this
// grid exists to prevent: what must not change is the height for a given
// width as vehicles come and go, and rendering all
// MAX_VEHICLES_PER_ZONE_SIDE slots regardless of occupancy is what secures
// that.
export const LANE_GRID_COLUMNS = 'repeat(auto-fill, 5rem)'
