// A compact −/count/+ control for "how many copies of this card are in the
// deck". It is deliberately colour-neutral (`border-current`, inherited text)
// so it reads correctly both on a parchment card face and on the dark deck
// list; callers add padding/size through `className`.
//
// It reports a *delta*, not a target quantity: `copies` is a render-time prop,
// so two clicks batched into one render would both compute the same target and
// the second step would be lost. The owner applies the delta to its freshest
// state instead.
//
// Bounds show up here as disabled buttons — `+` at `max`, `−` at 0 — so the
// control never asks for a quantity outside the deck rules. `setDeckCopies`
// still clamps: disabled buttons are an affordance, not a guarantee.
export function CopyStepper({
  copies, max, onStep, label, className = '',
}: {
  copies: number
  max: number
  onStep: (delta: 1 | -1) => void
  /** Names the card this stepper belongs to, for screen readers. */
  label: string
  className?: string
}) {
  const btn = 'px-1.5 font-bold leading-none disabled:cursor-not-allowed disabled:opacity-30'
  return (
    <span
      role="group"
      aria-label={label}
      // The pool card's face opens the details modal. The stepper sits inside
      // that face, so every activation — a mouse click, or Enter/Space on a
      // button, which also fires a click — has to stop here.
      onClick={(e) => e.stopPropagation()}
      className={`flex items-center gap-1 rounded-full border border-current ${className}`}
    >
      <button
        type="button"
        disabled={copies <= 0}
        aria-label={`Remove a copy (${copies} in deck)`}
        onClick={() => onStep(-1)}
        className={btn}
      >
        −
      </button>
      <span className="min-w-[1.5ch] text-center font-bold tabular-nums">{copies}</span>
      <button
        type="button"
        disabled={copies >= max}
        aria-label={`Add a copy (${copies} of ${max} in deck)`}
        onClick={() => onStep(1)}
        className={btn}
      >
        +
      </button>
    </span>
  )
}
