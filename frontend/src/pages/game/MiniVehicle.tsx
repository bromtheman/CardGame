import { shortHandNumber } from '@shared/format'
import { effectiveMaterialCostOf } from '@shared/engine/index'
import type { ZoneCardEntry } from '@shared/engine/engineTypes'
import { VEHICLE_TYPES } from '@shared/gameSettings'
import { KeywordIcons } from '../../components/KeywordIcons'
import shipIcon from '../../assets/icons/shipSVG.svg'
import planeIcon from '../../assets/icons/planeSVG.svg'
import subIcon from '../../assets/icons/submarineSVG.svg'
import tankIcon from '../../assets/icons/tankSVG.svg'
import airshipIcon from '../../assets/icons/airShield1SVG.svg'
import anchorIcon from '../../assets/icons/anchorSVG.svg'

const VEHICLE_ICONS: Record<string, string> = {
  [VEHICLE_TYPES.SHIP]: shipIcon,
  [VEHICLE_TYPES.PLANE]: planeIcon,
  [VEHICLE_TYPES.SUB]: subIcon,
  [VEHICLE_TYPES.TANK]: tankIcon,
  [VEHICLE_TYPES.AIRSHIP]: airshipIcon,
}

// Compact in-zone representation of a played vehicle — always shows the
// vehicle-type icon (never card art) since it must stay legible at this size.
export function MiniVehicle({
  entry,
  turnNumber,
  selected,
  onClick,
  dimmed,
}: {
  entry: ZoneCardEntry
  turnNumber: number
  selected?: boolean
  onClick?: () => void
  dimmed?: boolean
}) {
  const icon = VEHICLE_ICONS[entry.vehicleType ?? ''] ?? anchorIcon
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
    </div>
  )
}
