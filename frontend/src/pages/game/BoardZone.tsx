import type { ReactNode } from 'react'
import type { ZoneState } from '@shared/engine/gameInit'
import type { Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { KEYWORDS, VEHICLE_TYPES, ZONE_TYPES } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import { MiniVehicle } from './MiniVehicle'
import type { ZoneEffectBadge, ZoneEffectIcon } from './zoneEffectBadges'
import anchorIcon from '../../assets/icons/anchorSVG.svg'
import crosshairIcon from '../../assets/icons/crosshairSVG.svg'
import torpedoIcon from '../../assets/icons/torpedoSVG.svg'
import noSubsIcon from '../../assets/icons/noSubsSVG.svg'
import ship2Icon from '../../assets/icons/ship2SVG.svg'

const ZONE_EFFECT_ICONS: Record<ZoneEffectIcon, string> = {
  anchor: anchorIcon,
  crosshair: crosshairIcon,
  torpedo: torpedoIcon,
  noSubs: noSubsIcon,
  ghostShip: ship2Icon,
}

const BIOME_TINT: Record<string, string> = {
  [ZONE_TYPES.WATER]: 'bg-ocean-600/20',
  [ZONE_TYPES.BEACH]: 'bg-parchment-300/10',
  [ZONE_TYPES.LAND]: 'bg-brass-400/10',
}

function HpBar({ label, hp, max, own = true }: { label: string; hp: number; max: number; own?: boolean }) {
  const clamped = Math.max(0, hp)
  const pct = max > 0 ? Math.max(0, Math.min(100, (clamped / max) * 100)) : 0
  const low = pct < 25
  // Own bases fill in brass and the opponent's in muted ocean, the same
  // own/enemy convention the zone badges below use. Either goes red once the
  // base is nearly down — that matters to both players, whoever benefits.
  const fill = low ? 'bg-red-500' : own ? 'bg-brass-400' : 'bg-ocean-300'
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-ocean-300">
        <span>{label}</span>
        <span>{shortHandNumber(clamped)} / {shortHandNumber(max)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-ocean-950">
        <div
          className={`h-full transition-all duration-500 ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// Persistent zone markers (DWG Waters and any later ones) shown beside the
// zone title: own markers in brass, the opponent's in red.
function ZoneEffectBadges({ badges }: { badges: ZoneEffectBadge[] }) {
  if (badges.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {badges.map((badge) => (
        <span
          key={badge.key}
          title={badge.detail}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            badge.mine
              ? 'border-brass-400 bg-brass-400/15 text-brass-400'
              : 'border-red-500 bg-red-500/15 text-red-400'
          }`}
        >
          <img src={ZONE_EFFECT_ICONS[badge.icon]} alt="" className="h-3 w-3" />
          {badge.label}
        </span>
      ))}
    </span>
  )
}

// One zone panel: enemy base HP on top, enemy vehicles, own vehicles, own
// base HP on the bottom. `highlighted`/`onZoneClick` let HandBar's placing
// mode (and move-mode's zone-picking step) target a legal zone; `children`
// is the Task 11 action-button slot.
//
// Move-mode props (Task 12): `canMoveVehicles` gates the small per-vehicle
// "move" affordance on eligible Mobile vehicles; `moveVehiclePickMode` makes
// every own vehicle clickable to start a Rapid Redeployment move; both feed
// the same move-mode GameBoardPage drives (see HeroPowerBar's MoveMode).
//
// Field-targeting (Task 9): `fieldTargetingActive` makes every vehicle chip
// on the board — either side — clickable, for an ability with
// playOnVehicleEffect; click reports `onFieldTargetClick(instanceId)`.
//
// Swap-mode (Task 10, DWG's Boarding Party): `swapPickOwnMode` makes own DWG
// ships clickable to start the trade; `swapPickEnemyMode` (true only in the
// zone holding the already-picked own ship) makes enemy ships clickable to
// complete it. Both filters mirror the engine's own validation in
// shared/engine/heroPowers.ts's boardingParty (faction/vehicleType/zone) —
// display-only, the server re-validates (including the cost check, which
// this component deliberately does not pre-filter on).
export function BoardZone({
  zone,
  maxBaseHp,
  mySide,
  theirSide,
  turnNumber,
  highlighted,
  onZoneClick,
  children,
  canMoveVehicles,
  canActivateVehicles,
  moveVehiclePickMode,
  selectedForMoveId,
  onPickVehicleForMove,
  onMobileMoveClick,
  onActivateClick,
  fieldTargetingActive,
  onFieldTargetClick,
  swapPickOwnMode,
  swapPickEnemyMode,
  selectedForSwapOwnId,
  onPickOwnForSwap,
  onPickEnemyForSwap,
  zoneEffectBadgeList,
}: {
  zone: ZoneState
  maxBaseHp: number
  mySide: Side
  theirSide: Side
  turnNumber: number
  highlighted?: boolean
  onZoneClick?: () => void
  children?: ReactNode
  canMoveVehicles?: boolean
  canActivateVehicles?: boolean
  moveVehiclePickMode?: boolean
  selectedForMoveId?: string | null
  onPickVehicleForMove?: (instanceId: string) => void
  onMobileMoveClick?: (instanceId: string) => void
  onActivateClick?: (instanceId: string) => void
  fieldTargetingActive?: boolean
  onFieldTargetClick?: (instanceId: string) => void
  swapPickOwnMode?: boolean
  swapPickEnemyMode?: boolean
  selectedForSwapOwnId?: string | null
  onPickOwnForSwap?: (instanceId: string) => void
  onPickEnemyForSwap?: (instanceId: string) => void
  /** Persistent markers on THIS zone, from ./zoneEffectBadges. */
  zoneEffectBadgeList?: ZoneEffectBadge[]
}) {
  return (
    <section
      onClick={onZoneClick}
      className={`flex flex-col gap-2 rounded border p-3 ${BIOME_TINT[zone.biome] ?? 'bg-ocean-900/20'} ${
        highlighted ? 'cursor-pointer border-brass-400 ring-2 ring-brass-400' : 'border-ocean-600'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg">
          Zone {zone.id} <span className="text-sm capitalize text-ocean-300">({zone.biome})</span>
        </p>
        <ZoneEffectBadges badges={zoneEffectBadgeList ?? []} />
      </div>
      {/* Both bases, mirroring the zone's own layout: the enemy above their
          vehicles, yours below yours. Base HP is public state and losing two
          zones loses the game, so a player cannot judge the board without
          seeing how close the opponent's base is to falling. */}
      <HpBar label="Enemy base" hp={zone.baseHp[theirSide]} max={maxBaseHp} own={false} />
      <div className="flex min-h-[76px] flex-wrap gap-1">
        {(zone.cards[theirSide] as ZoneCardEntry[]).map((c) => {
          const swapEnemyEligible = !!swapPickEnemyMode && c.vehicleType === VEHICLE_TYPES.SHIP
          return (
            <MiniVehicle
              key={c.instanceId}
              entry={c}
              turnNumber={turnNumber}
              onClick={
                fieldTargetingActive
                  ? () => onFieldTargetClick?.(c.instanceId)
                  : swapEnemyEligible
                    ? () => onPickEnemyForSwap?.(c.instanceId)
                    : undefined
              }
            />
          )
        })}
      </div>
      <div className="flex min-h-[76px] flex-wrap gap-1 border-t border-ocean-600/50 pt-2">
        {(zone.cards[mySide] as ZoneCardEntry[]).map((c) => {
          const mobileEligible = !!canMoveVehicles && c.keywords.includes(KEYWORDS.MOBILE) && c.movedOnTurn !== turnNumber
          const activateEligible =
            !!canActivateVehicles &&
            typeof (c.meta as { activateCpCost?: unknown }).activateCpCost === 'number' &&
            typeof (c.meta as { onActivate?: unknown }).onActivate === 'string' &&
            c.activatedOnTurn !== turnNumber
          const swapOwnEligible = !!swapPickOwnMode && c.faction === 'DWG' && c.vehicleType === VEHICLE_TYPES.SHIP
          return (
            <MiniVehicle
              key={c.instanceId}
              entry={c}
              turnNumber={turnNumber}
              selected={selectedForMoveId === c.instanceId || selectedForSwapOwnId === c.instanceId}
              onClick={
                fieldTargetingActive
                  ? () => onFieldTargetClick?.(c.instanceId)
                  : moveVehiclePickMode
                    ? () => onPickVehicleForMove?.(c.instanceId)
                    : swapOwnEligible
                      ? () => onPickOwnForSwap?.(c.instanceId)
                      : undefined
              }
              moveAffordance={mobileEligible}
              onMoveClick={mobileEligible ? () => onMobileMoveClick?.(c.instanceId) : undefined}
              activateAffordance={activateEligible}
              onActivateClick={activateEligible ? () => onActivateClick?.(c.instanceId) : undefined}
            />
          )
        })}
      </div>
      <HpBar label="Your base" hp={zone.baseHp[mySide]} max={maxBaseHp} />
      {children && (
        <div onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </section>
  )
}
