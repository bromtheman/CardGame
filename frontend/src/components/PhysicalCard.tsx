import { useState, type ReactNode } from 'react'
import { shortHandNumber } from '@shared/format'
import type { CardRow } from '../lib/cards'
import { cardImageOrFallback } from '../lib/cards'
import { KeywordIcons } from './KeywordIcons'
import { CardDetailsModal } from './CardDetailsModal'

// The 280×430 card face (spec §11).
//
// Every card face always has a route to CardDetailsModal, but which one depends
// on whether the call site claimed the click:
//   - no `onClick` (collection, create-card preview, deck pool, hand abilities)
//     → pressing the face itself opens the details modal.
//   - `onClick` given (playing a vehicle from hand) → the face does that, so a
//     corner "Details" button carries the modal instead.
// The modal state lives here so no call site has to wire it up.
export function PhysicalCard({
  card, onClick, effectiveCost, footer,
}: {
  card: CardRow
  /** Claims the face's press (play / target). Omit to let it open details. */
  onClick?: () => void
  /** In-game cost when it differs from the printed one — shown in the modal. */
  effectiveCost?: number
  /**
   * Bottom-right corner slot (the deck builder puts its copy stepper here).
   * Takes the place of the "Details" button when both would apply.
   */
  footer?: ReactNode
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const activate = onClick ?? (() => setDetailsOpen(true))
  const img = cardImageOrFallback(card)
  const keywords = Array.isArray(card.keywords) ? (card.keywords as string[]) : []
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={onClick ? card.name : `${card.name} — show card details`}
      onClick={activate}
      onKeyDown={(e) => {
        // Only when the face itself has focus: Enter/Space on a control inside
        // `footer` bubbles up here too, and must not also fire the face.
        if (e.target !== e.currentTarget) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        activate()
      }}
      className="flex h-[430px] w-[280px] cursor-pointer flex-col rounded-xl border-2 border-ocean-950 bg-parchment-100 p-3 text-ocean-950 shadow-plank transition-transform hover:-translate-y-1 focus:outline-none focus-visible:ring-4 focus-visible:ring-brass-400"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-lg" title={card.name}>{card.name}</span>
        <span className="text-xs uppercase text-ocean-600">{card.vehicle_type ?? card.type}</span>
      </div>
      <div className="mt-2 flex h-[180px] items-center justify-center overflow-hidden rounded bg-parchment-300 shadow-inner">
        <img
          src={img.src}
          alt={card.name}
          className={img.isFallback ? 'h-24 w-24 opacity-60' : 'h-full w-full object-cover'}
        />
      </div>
      <p className="mt-2 flex-1 overflow-y-auto text-sm leading-snug">{card.card_text}</p>
      <div className="mt-2 flex items-end justify-between">
        <span className="flex items-center gap-1">
          <span className="rounded-full bg-ocean-900 px-3 py-1 font-bold text-parchment-100">
            {shortHandNumber(card.material_cost)}
          </span>
          {card.cp_cost > 0 && (
            <span className="rounded-full bg-brass-400 px-2 py-1 text-sm font-bold text-ocean-950">
              {card.cp_cost} CP
            </span>
          )}
        </span>
        <KeywordIcons keywords={keywords} />
      </div>
      <div className="mt-1 flex min-h-7 items-center justify-between gap-2 text-xs text-ocean-600">
        <span>{card.is_built_in ? card.faction : 'CUSTOM'}</span>
        {footer ?? (onClick && (
          <button
            type="button"
            title={`Show ${card.name} full screen and explain its attributes`}
            onClick={(e) => {
              e.stopPropagation()
              setDetailsOpen(true)
            }}
            className="rounded border border-ocean-600 px-2 py-0.5 font-bold uppercase tracking-wide text-ocean-900 hover:bg-ocean-900 hover:text-parchment-100"
          >
            Details
          </button>
        ))}
      </div>
      <CardDetailsModal
        card={card}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        effectiveCost={effectiveCost}
      />
    </div>
  )
}
