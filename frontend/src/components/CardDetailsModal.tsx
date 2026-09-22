import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { shortHandNumber } from '@shared/format'
import { chargeMaxOf, effectiveMaterialCostOf } from '@shared/engine/index'
import type { ShipProfile } from '@shared/shipProfiles'
import { shipProfileOf } from '@shared/shipProfiles'
import type { CardRow } from '../lib/cards'
import { cardImageOrFallback } from '../lib/cards'
import { attributesOf } from '../lib/keywords'
import type { ProfileRow } from '../lib/shipProfileView'
import { shipProfileHeadline, shipProfileRows } from '../lib/shipProfileView'
import { SegmentBar } from './SegmentBar'
import { useEscapeToCancel } from './ConfirmDialog'

function keywordsOf(card: CardRow): string[] {
  return Array.isArray(card.keywords) ? (card.keywords as string[]) : []
}

function CostChip({
  label, value, muted, children,
}: { label: string; value: string; muted?: boolean; children?: ReactNode }) {
  return (
    <div className={`rounded border px-3 py-2 ${muted ? 'border-ocean-600 text-ocean-300' : 'border-brass-400'}`}>
      <p className="text-xs uppercase tracking-wide text-ocean-300">{label}</p>
      <p className="font-display text-xl">{value}</p>
      {children}
    </div>
  )
}

// The five headline scores: label and bar, nothing else. Their `why` is
// percentile wording ("64th percentile") that competed with the bar for
// attention and said the same thing less clearly, so it stays as a hover title.
function ScoreList({ rows }: { rows: ProfileRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3" title={r.why}>
          <span className="font-bold">{r.label}</span>
          <SegmentBar value={r.score} max={5} label={r.spoken} className="w-full max-w-56" />
        </li>
      ))}
    </ul>
  )
}

// The four matchups keep their reason printed: unlike a percentile it names
// the armament the score is drawn from, which is the part a player acts on.
// It sits UNDER the bar, so the bars line up with the five scores' above.
function MatchupList({ rows }: { rows: ProfileRow[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-1">
          <span className="font-bold">{r.label}</span>
          <SegmentBar value={r.score} max={5} label={r.spoken} className="w-full max-w-56" />
          <span className="col-start-2 text-sm leading-snug text-ocean-300">{r.why}</span>
        </li>
      ))}
    </ul>
  )
}

// The glimpse of the real craft behind a built-in hull (shared/shipProfiles.ts):
// what it is, how it rates, and what it is good and bad against — the
// report's own words, so a player picking a fleet knows what they are
// sending into the From The Depths battle.
function ShipProfilePanel({ profile, faction }: { profile: ShipProfile; faction: string }) {
  const { scores, matchups } = shipProfileRows(profile)
  const facts: [string, string | undefined][] = [
    ['Type', profile.type], ['Speed', profile.speed], ['Fights at', profile.fightsAt],
    ['Sees', profile.sees], ['Escort', profile.escort],
  ]
  return (
    <div className="flex flex-col gap-4 rounded border border-ocean-600 bg-ocean-950/50 p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-ocean-300">
          {shipProfileHeadline(profile, faction)}
        </p>
        <p className="mt-1 text-lg leading-snug">{profile.summary}</p>
        {profile.note && <p className="mt-1 text-sm italic text-ocean-300">{profile.note}</p>}
      </div>
      <ScoreList rows={scores} />
      <MatchupList rows={matchups} />
      <p className="text-sm leading-relaxed">
        <span className="font-bold text-brass-400">Verdict: {profile.verdict}.</span> {profile.verdictDetail}
      </p>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
        {facts.map(([label, value]) => value && (
          <Fragment key={label}>
            <dt className="text-ocean-300">{label}</dt>
            <dd className="leading-snug">{value}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="text-xs text-ocean-300">
        Scores are fifths of the Neter campaign&rsquo;s craft (1 = bottom fifth, 5 = top fifth); matchups are
        judgement calls from the weapon fit.
      </p>
    </div>
  )
}

const FADE_MS = 150

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

  // `open` going false would unmount the overlay on the spot, so hold it one
  // fade longer on the way out. The fade IN is left to CSS `@starting-style`
  // (Tailwind's `starting:` variant) rather than a rAF that flips a class:
  // rAF does not run while the page isn't compositing, which would leave the
  // overlay stuck at opacity 0.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), FADE_MS)
    return () => clearTimeout(timer)
  }, [open])

  // Only a press that STARTS on the backdrop closes: dragging from inside the
  // panel (selecting card text) and releasing outside fires `click` on the
  // overlay too, and that must not count as clicking away.
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    if (!mounted) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mounted])

  if (!mounted) return null

  const img = cardImageOrFallback(card)
  const keywords = keywordsOf(card)
  const meta = (card.meta ?? {}) as Record<string, unknown>
  const attributes = attributesOf(card.vehicle_type, keywords, meta)
  const chargeMax = chargeMaxOf({ meta })
  const halved = effectiveMaterialCostOf({ materialCost: card.material_cost, keywords })
  const inGameCost = effectiveCost ?? halved
  // Built-in only: a custom card may borrow a seeded name without being that craft.
  const profile = card.is_built_in ? shipProfileOf(card.faction, card.name) : null
  // Every built-in vehicle is due a profile (OW, TG and GT await their FtD
  // reports), so it keeps the two-column layout even before its profile lands.
  // Abilities and custom cards never get one, and take the single column.
  const twoColumn = profile !== null || (card.is_built_in && card.type === 'vehicle')

  return createPortal(
    <div
      className={`fixed inset-0 z-50 overflow-y-auto bg-ocean-950/90 p-4 transition-opacity duration-150 ease-out motion-reduce:transition-none sm:p-8 ${
        open ? 'opacity-100 starting:opacity-0' : 'pointer-events-none opacity-0'
      }`}
      onPointerDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => {
        // The modal is portalled, but React replays events along the React
        // tree — where it is still a child of the clickable card face. Without
        // this the backdrop click closed the modal and the very same event
        // re-opened it via PhysicalCard's own handler.
        e.stopPropagation()
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose()
      }}
    >
      {/* Two columns for a built-in vehicle, whose right column holds its ship
          profile; any other card is the left column alone, so the dialog
          narrows to it. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} — card details`}
        onClick={(e) => e.stopPropagation()}
        className={`mx-auto flex min-h-full flex-col gap-6 rounded-xl border-2 border-brass-400 bg-ocean-900 p-6 shadow-plank transition-transform duration-150 ease-out motion-reduce:transition-none ${
          twoColumn ? 'max-w-5xl' : 'max-w-md'
        } ${open ? 'translate-y-0 starting:translate-y-1' : 'translate-y-1'}`}
      >
        {/* The name heads the whole dialog rather than sitting under the
            image, so the image and the profile panel start on one line. */}
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h2 className="font-display text-3xl">{card.name}</h2>
            <p className="text-sm uppercase tracking-wide text-ocean-300">
              {card.is_built_in ? card.faction : 'Custom'} · {card.vehicle_type ?? card.type}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="shrink-0 rounded border border-ocean-600 px-3 py-1 font-bold text-parchment-100"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-6 md:flex-row">
          <section className={`flex w-full flex-col ${twoColumn ? 'md:w-[360px] md:shrink-0' : ''}`}>
            <div className="flex h-[280px] items-center justify-center overflow-hidden rounded bg-parchment-300 shadow-inner">
              <img
                src={img.src}
                alt={card.name}
                className={img.isFallback ? 'h-32 w-32 opacity-60' : 'h-full w-full object-cover'}
              />
            </div>
            {card.card_text && (
              <p className="mt-4 whitespace-pre-line rounded bg-ocean-950/60 p-3 leading-relaxed">
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
              {chargeMax > 0 && (
                <CostChip label="Charge" value={`⚡${chargeMax}`}>
                  <SegmentBar
                    value={chargeMax}
                    max={chargeMax}
                    variant="capacity"
                    label={`Stores up to ${chargeMax} charge`}
                    className="mt-1 w-full min-w-14"
                  />
                </CostChip>
              )}
              {card.blueprint_cost > 0 && (
                <CostChip label="Blueprint" value={shortHandNumber(card.blueprint_cost)} muted />
              )}
            </div>

            <h3 className="mt-6 font-display text-2xl">Card&rsquo;s Attributes</h3>
            {attributes.length === 0 ? (
              <p className="mt-3 text-ocean-300">
                This card has no vehicle type or modifiers — everything it does is in its card text.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
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

          {/* No heading: the panel's own headline and bars say what it is. The
              placeholder keeps a not-yet-profiled vehicle's right column from
              reading as a layout that failed to load. */}
          {twoColumn && (
            <section className="flex min-w-0 flex-1 flex-col">
              {profile ? (
                <ShipProfilePanel profile={profile} faction={card.faction} />
              ) : (
                <p className="rounded border border-dashed border-ocean-600 bg-ocean-950/50 p-4 text-sm text-ocean-300">
                  No From The Depths profile for this craft yet.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
