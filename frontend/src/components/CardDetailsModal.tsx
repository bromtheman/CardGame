import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { shortHandNumber } from '@shared/format'
import { effectiveMaterialCostOf } from '@shared/engine/index'
import type { CardRow } from '../lib/cards'
import { cardImageOrFallback } from '../lib/cards'
import { attributesOf } from '../lib/keywords'
import { useEscapeToCancel } from './ConfirmDialog'

function keywordsOf(card: CardRow): string[] {
  return Array.isArray(card.keywords) ? (card.keywords as string[]) : []
}

function CostChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${muted ? 'border-ocean-600 text-ocean-300' : 'border-brass-400'}`}>
      <p className="text-xs uppercase tracking-wide text-ocean-300">{label}</p>
      <p className="font-display text-xl">{value}</p>
    </div>
  )
}

// Full-screen blow-up of one card plus a plain-English glossary of every
// attribute it carries (vehicle type + keywords), so a player never has to
// guess what "Stealthy" or "Scrappy" does mid-game.
//
// Portalled to document.body on purpose: call sites render PhysicalCard inside
// `scale-75`/`scale-90` wrappers (HandBar, DeckBuilderPage), and a transformed
// ancestor would make `position: fixed` resolve against that wrapper instead of
// the viewport — the overlay would render scaled and boxed inside the card.
export function CardDetailsModal({
  card, open, onClose, effectiveCost,
}: {
  card: CardRow
  open: boolean
  onClose: () => void
  /** In-game cost when it differs from the printed one (cost modifiers). */
  effectiveCost?: number
}) {
  useEscapeToCancel(open, onClose)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open) return null

  const img = cardImageOrFallback(card)
  const keywords = keywordsOf(card)
  const attributes = attributesOf(card.vehicle_type, keywords)
  const halved = effectiveMaterialCostOf({ materialCost: card.material_cost, keywords })
  const inGameCost = effectiveCost ?? halved

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ocean-950/90 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} — card details`}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex min-h-full max-w-5xl flex-col gap-6 rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank md:flex-row"
      >
        <section className="flex w-full flex-col md:w-[360px] md:shrink-0">
          <div className="flex h-[280px] items-center justify-center overflow-hidden rounded bg-parchment-300 shadow-inner">
            <img
              src={img.src}
              alt={card.name}
              className={img.isFallback ? 'h-32 w-32 opacity-60' : 'h-full w-full object-cover'}
            />
          </div>
          <h2 className="mt-4 font-display text-3xl">{card.name}</h2>
          <p className="text-sm uppercase tracking-wide text-ocean-300">
            {card.is_built_in ? card.faction : 'Custom'} · {card.vehicle_type ?? card.type}
          </p>
          {card.card_text && (
            <p className="mt-3 whitespace-pre-line rounded bg-ocean-950/60 p-3 leading-relaxed">
              {card.card_text}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <CostChip
              label="Materials"
              value={
                inGameCost === card.material_cost
                  ? shortHandNumber(card.material_cost)
                  : `${shortHandNumber(inGameCost)} (was ${shortHandNumber(card.material_cost)})`
              }
            />
            {card.cp_cost > 0 && <CostChip label="CP" value={String(card.cp_cost)} />}
            {card.blueprint_cost > 0 && (
              <CostChip label="Blueprint" value={shortHandNumber(card.blueprint_cost)} muted />
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-display text-2xl">What this card&rsquo;s attributes do</h3>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="rounded border border-ocean-600 px-3 py-1 font-bold text-parchment-100"
            >
              Close
            </button>
          </div>
          {attributes.length === 0 ? (
            <p className="mt-4 text-ocean-300">
              This card has no vehicle type or modifiers — everything it does is in its card text.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {attributes.map((attr) => (
                <li key={attr.key} className="flex gap-3 rounded border border-ocean-600 bg-ocean-950/50 p-3">
                  <img src={attr.icon} alt="" aria-hidden className="h-8 w-8 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-brass-400">{attr.label}</p>
                    <p className="text-sm leading-relaxed text-parchment-100">{attr.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>,
    document.body,
  )
}
