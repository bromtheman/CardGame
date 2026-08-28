import { useState } from 'react'
import { shortHandNumber } from '@shared/format'
import { effectiveMaterialCostOf } from '@shared/engine/index'
import type { ZoneCardEntry } from '@shared/engine/engineTypes'
import { KeywordIcons } from '../../components/KeywordIcons'
import { CardDetailsModal } from '../../components/CardDetailsModal'
import { cardInstanceToRow } from '../../lib/cards'
import { vehicleTypeIcon } from '../../lib/keywords'

// Compact in-zone representation of a played vehicle — always shows the
// vehicle-type icon (never card art) since it must stay legible at this size.
// The corner "?" opens the same CardDetailsModal the full card face uses, so a
// vehicle's keywords stay readable in play and not just in the collection.
export function MiniVehicle({
  entry,
  turnNumber,
  selected,
  onClick,
  dimmed,
  moveAffordance,
  onMoveClick,
  activateAffordance,
  onActivateClick,
}: {
  entry: ZoneCardEntry
  turnNumber: number
  selected?: boolean
  onClick?: () => void
  dimmed?: boolean
  /** Show the small "move" corner button (Mobile keyword, eligible to move this turn). */
  moveAffordance?: boolean
  onMoveClick?: () => void
  /** Show the small "use" corner button (has an activated ability, unused this turn). */
  activateAffordance?: boolean
  onActivateClick?: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const icon = vehicleTypeIcon(entry.vehicleType)
  const fresh = entry.playedOnTurn === turnNumber

  return (
    <div
      onClick={onClick}
      title={entry.name}
      className={`relative flex w-20 shrink-0 flex-col items-center rounded border p-1 text-center ${
        selected ? 'border-brass-400 bg-brass-400/20' : 'border-ocean-600 bg-ocean-950/60'
      } ${dimmed ? 'opacity-40' : ''} ${
        onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : ''
      }`}
    >
      {fresh && (
        <span className="absolute -right-1 -top-1 rounded-full bg-ocean-300 px-1 text-[9px] font-bold text-ocean-950">
          new
        </span>
      )}
      {moveAffordance && onMoveClick && (
        <button
          type="button"
          title="Move to another zone"
          onClick={(e) => {
            e.stopPropagation()
            onMoveClick()
          }}
          className="absolute -left-1 -top-1 rounded-full bg-brass-400 px-1 text-[9px] font-bold text-ocean-950"
        >
          move
        </button>
      )}
      {activateAffordance && onActivateClick && (
        <button
          type="button"
          title="Use this vehicle's activated ability"
          onClick={(e) => {
            e.stopPropagation()
            onActivateClick()
          }}
          className="absolute -bottom-1 -left-1 rounded-full bg-brass-400 px-1 text-[9px] font-bold text-ocean-950"
        >
          use
        </button>
      )}
      <img src={icon} alt={entry.vehicleType ?? entry.type} className="h-8 w-8 opacity-80" />
      <span className="mt-1 w-full truncate font-display text-[13px]">{entry.name}</span>
      <span className="rounded-full bg-ocean-900 px-2 py-0.5 text-[11px] font-bold text-parchment-100">
        {shortHandNumber(effectiveMaterialCostOf(entry))}
      </span>
      {entry.keywords.length > 0 && (
        <div className="mt-1 flex scale-75 flex-wrap justify-center gap-0.5">
          <KeywordIcons keywords={entry.keywords} />
        </div>
      )}
      <button
        type="button"
        title={`Show ${entry.name} full screen and explain its attributes`}
        aria-label={`Details for ${entry.name}`}
        onClick={(e) => {
          e.stopPropagation()
          setDetailsOpen(true)
        }}
        className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-ocean-600 bg-ocean-900 text-[10px] font-bold leading-none text-parchment-100 hover:bg-brass-400 hover:text-ocean-950"
      >
        ?
      </button>
      <CardDetailsModal
        card={cardInstanceToRow(entry)}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        effectiveCost={effectiveMaterialCostOf(entry)}
      />
    </div>
  )
}
