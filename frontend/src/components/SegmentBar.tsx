// A 1..max rating drawn as one filled bar cut into segments by diagonal
// slashes — the ship profile's five scores and four matchups, and an LH
// hull's charge capacity.
//
// How the slashes are made: the strip of segments is skewed as a whole inside
// a straight-edged, `overflow-hidden` box. The flex `gap` between segments is
// laid out BEFORE the skew, so each gap comes out as a diagonal cut, while the
// box clips the skew's overhang so the bar's own left and right edges stay
// vertical. That is why the strip is deliberately wider than its box.
const SKEW = '-skew-x-[20deg]'

/** Height and overhang per size; the overhang must clear (height / 2) × tan 20°. */
const SIZES = {
  sm: { box: 'h-2.5', strip: '-ml-1 w-[calc(100%+0.5rem)]' },
  md: { box: 'h-3.5', strip: '-ml-1.5 w-[calc(100%+0.75rem)]' },
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
   * `score` fills `value` of `max`. `capacity` fills every segment in a muted
   * tone instead: a card in the collection or in hand has a charge CAP but no
   * live charge, and drawing that as a full bar would claim pips it has not
   * earned — while drawing it empty would read as zero.
   */
  variant?: 'score' | 'capacity'
  /**
   * Pixels per segment, so the bar's LENGTH is the capacity — a 4-charge hull
   * draws twice as long as a 2-charge one. Omit to size it with `className`
   * instead (the ship profile's fixed-width 1–5 scale).
   */
  segmentWidth?: number
  className?: string
}) {
  const filled = variant === 'capacity' ? max : Math.max(0, Math.min(max, value))
  const { box, strip } = SIZES[size]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={segmentWidth === undefined ? undefined : { width: max * segmentWidth }}
      className={`inline-flex ${box} overflow-hidden rounded-[3px] bg-ocean-950 ring-1 ring-inset ring-ocean-600 ${className}`}
    >
      <span className={`flex ${strip} ${SKEW} gap-[2px]`} aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={`flex-1 ${
              i < filled ? (variant === 'capacity' ? 'bg-brass-400/40' : 'bg-brass-400') : 'bg-ocean-800'
            }`}
          />
        ))}
      </span>
    </span>
  )
}
