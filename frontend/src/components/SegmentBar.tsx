// A 1..max rating drawn as one filled bar cut into segments by diagonal
// slashes — the ship profile's five scores and four matchups, and an LH
// hull's charge capacity.
//
// How the slashes are made: the strip of segments is skewed as a whole inside
// a straight-edged, `overflow-hidden` box. The flex `gap` between segments is
// laid out BEFORE the skew, so each gap comes out as a diagonal cut, while the
// box clips the skew's overhang so the bar's own left and right edges stay
// vertical. Three details keep that trick clean:
//   - The strip is `shrink-0`. It is deliberately wider than its box, and a
//     flex item shrinks to fit by default — which silently deleted the right
//     overhang, so the skew pulled the last segment's bottom corner inside the
//     box (a notch at the bar's end) and every slash sat off-centre.
//   - The box has no background and no ring. Anything painted on the box shows
//     through every gap: an inset ring did, as a light tick at the top and the
//     bottom of each slash. A gap now shows only the surface the bar sits on.
//   - The end segments are wider by the overhang, so after clipping every
//     visible segment is the same length.
const SKEW = '-skew-x-[20deg]'
/** The slash width — keep in step with the strip's literal `gap-[2px]`. */
const GAP_PX = 2

// Per size: the box height, the strip's overhang on each side, and the extra
// basis an end segment needs to cover that overhang. The overhang must clear
// (height / 2) × tan 20° — 1.8px at h-2.5, 2.5px at h-3.5.
const SIZES = {
  sm: { box: 'h-2.5', strip: '-ml-1 w-[calc(100%+0.5rem)]', end: 'basis-1' },
  md: { box: 'h-3.5', strip: '-ml-1.5 w-[calc(100%+0.75rem)]', end: 'basis-1.5' },
} as const

export function SegmentBar({
  value, max, label, size = 'md', variant = 'score', segmentWidth, className = '',
}: {
  /** Segments to fill, 0..max. Ignored by the `capacity` variant. */
  value: number
  max: number
  /** Spoken and hover text — the bar carries no visible number of its own. */
  label: string
  size?: keyof typeof SIZES
  /**
   * `score` fills `value` of `max` in brass. `capacity` fills every segment in
   * steel gray instead: a card in the collection or in hand has a charge CAP
   * but no live charge, and drawing that in the brass of a real reading would
   * claim pips it has not earned — while drawing it empty would read as zero.
   */
  variant?: 'score' | 'capacity'
  /**
   * Visible pixels per segment (the slashes are added on top), so the bar's
   * LENGTH is the capacity and every segment lands on whole pixels. Omit to
   * size it with `className` instead (the ship profile's fixed-width 1–5 scale).
   */
  segmentWidth?: number
  className?: string
}) {
  const filled = variant === 'capacity' ? max : Math.max(0, Math.min(max, value))
  const { box, strip, end } = SIZES[size]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={segmentWidth === undefined ? undefined : { width: max * segmentWidth + (max - 1) * GAP_PX }}
      className={`inline-flex ${box} overflow-hidden rounded-[3px] ${className}`}
    >
      <span className={`flex shrink-0 ${strip} ${SKEW} gap-[2px]`} aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`grow ${i === 0 || i === max - 1 ? end : 'basis-0'} ${
              i < filled ? (variant === 'capacity' ? 'bg-steel-400' : 'bg-brass-400') : 'bg-ocean-800'
            }`}
          />
        ))}
      </span>
    </span>
  )
}
