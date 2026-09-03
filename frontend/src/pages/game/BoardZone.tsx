import type { ReactNode } from 'react'
import type { ZoneState } from '@shared/engine/gameInit'
import type { Side, ZoneCardEntry } from '@shared/engine/engineTypes'
import { KEYWORDS, MAX_VEHICLES_PER_ZONE_SIDE, VEHICLE_TYPES } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import { MiniVehicle } from './MiniVehicle'
import type { ZoneEffectBadge, ZoneEffectIcon } from './zoneEffectBadges'
import { LANE_GRID_COLUMNS, SLOT_HEIGHT_CLASS, SLOT_WIDTH_CLASS } from './laneLayout'
import { BIOME_BORDER, BIOME_TINT } from '../../lib/biomeStyles'
import anchorIcon from '../../assets/icons/anchorSVG.svg'
import crosshairIcon from '../../assets/icons/crosshairSVG.svg'
import torpedoIcon from '../../assets/icons/torpedoSVG.svg'
import noSubsIcon from '../../assets/icons/noSubsSVG.svg'
import ship2Icon from '../../assets/icons/ship2SVG.svg'
import shieldIcon from '../../assets/icons/shieldSVG.svg'

const ZONE_EFFECT_ICONS: Record<ZoneEffectIcon, string> = {
  anchor: anchorIcon,
  crosshair: crosshairIcon,
  torpedo: torpedoIcon,
  noSubs: noSubsIcon,
  ghostShip: ship2Icon,
  shield: shieldIcon,
}

function HpBar({ label, hp, max, own = true, badge }: {
  label: string; hp: number; max: number; own?: boolean
  /** That side's LaneCount — it rides the HP row rather than paying for one. */
  badge?: ReactNode
}) {
  const clamped = Math.max(0, hp)
  const pct = max > 0 ? Math.max(0, Math.min(100, (clamped / max) * 100)) : 0
  const low = pct < 25
  // Own bases fill in brass and the opponent's in muted ocean, the same
  // own/enemy convention the zone badges below use. Either goes red once the
  // base is nearly down — that matters to both players, whoever benefits.
  const fill = low ? 'bg-red-500' : own ? 'bg-brass-400' : 'bg-ocean-300'
  // Label, bar and figures share ONE line rather than stacking. Two bars per
  // panel at 24px each cost the board 48px of the height the viewport-fit pass
  // was trying to find; inline they cost 32, and read no worse for it.
  return (
    <div className="flex w-full items-center gap-2 text-[11px] leading-4 text-ocean-300">
      <span className="shrink-0">{label}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-ocean-950">
        <div
          className={`h-full transition-all duration-500 ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 tabular-nums">{shortHandNumber(clamped)} / {shortHandNumber(max)}</span>
      {badge}
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

// A side's vehicle lane: a fixed MAX_VEHICLES_PER_ZONE_SIDE-slot grid, with
// the unfilled slots drawn as dashed outlines.
//
// It is a GRID rather than the flex-wrap this used to be because the row
// count then followed the OCCUPANCY, so every few vehicles grew the lane and
// pushed the base HP bars (and the whole panel) down. Rendering all
// MAX_VEHICLES_PER_ZONE_SIDE slots whether or not they are filled cannot do
// that — the lane is the same height empty or full, which is only expressible
// now that the engine caps the side at eight.
//
// The empty slots also carry the cap: a player can see how many deployments
// they have left in this zone without counting chips.
function VehicleLane({
  entries,
  renderEntry,
  className = '',
}: {
  entries: ZoneCardEntry[]
  renderEntry: (entry: ZoneCardEntry) => ReactNode
  className?: string
}) {
  // A side can sit ABOVE the cap — spawns, revives and Boarding Party
  // deliberately bypass it (see gameSettings.MAX_VEHICLES_PER_ZONE_SIDE), so
  // this clamps at zero rather than rendering a negative slot count, and the
  // grid simply grows a row in that case instead of dropping a real hull.
  const emptySlots = Math.max(0, MAX_VEHICLES_PER_ZONE_SIDE - entries.length)
  return (
    <div
      // gap-x-0.5 (2px), not gap-1: four 5rem tracks plus three 4px gaps come
      // to 332px against a zone panel that is 331.7px wide at a 1440 viewport,
      // so a 4px gap loses the fourth column to a third of a pixel and makes
      // the lane half a row taller for nothing. 2px fits it with room to
      // spare. Vertical gap stays 4px — rows need the separation, columns
      // have the chips' own borders.
      className={`grid justify-center gap-x-0.5 gap-y-1 ${className}`}
      style={{ gridTemplateColumns: LANE_GRID_COLUMNS }}
    >
      {entries.map(renderEntry)}
      {Array.from({ length: emptySlots }, (_, i) => (
        <div
          key={`empty-${i}`}
          aria-hidden
          className={`${SLOT_HEIGHT_CLASS} ${SLOT_WIDTH_CLASS} rounded border border-dashed border-ocean-600/40`}
        />
      ))}
    </div>
  )
}

// The front line: enemy territory above it, yours below. Its own element
// rather than the `border-t` hairline the own-lane used to carry, because the
// eight-slot grid fills both lanes with dashed outlines and a 1px line at 50%
// opacity now reads as one more grid line instead of as the boundary between
// the two fleets. Brass to match the board's own accent, with a centre
// diamond so the midpoint is unmistakable even on an empty zone.
// It also now carries the zone's persistent effect markers. They used to sit in
// a title row above the panel; that row is gone, and a zone-wide marker belongs
// on the zone's own centre line as well as anywhere. With no markers this is
// just the divider, at its original height.
function FrontLine({ badges }: { badges: ZoneEffectBadge[] }) {
  const bare = badges.length === 0
  return (
    // FIXED h-5, badges or not. A row that grew when a zone effect appeared
    // would shove that zone's lanes down while its neighbours' stayed put —
    // the same height jump the fixed-slot lane grid exists to prevent.
    <div aria-hidden={bare} className="flex h-5 items-center gap-2">
      <span className="h-px flex-1 bg-brass-400/30" />
      {bare
        ? <span className="h-1.5 w-1.5 rotate-45 border border-brass-400/70" />
        : <ZoneEffectBadges badges={badges} />}
      <span className="h-px flex-1 bg-brass-400/30" />
    </div>
  )
}

// The "3/8" figure beside the zone title. Turns red once the side is full, so
// "why can I not play this here?" is answerable from the board itself.
function LaneCount({ count, mine }: { count: number; mine: boolean }) {
  const full = count >= MAX_VEHICLES_PER_ZONE_SIDE
  return (
    <span
      title={`${mine ? 'Your' : "Opponent's"} vehicles in this zone (limit ${MAX_VEHICLES_PER_ZONE_SIDE})`}
      // leading-4 with no vertical padding: it rides a 16px HP row now, and a
      // taller badge would grow that row for every zone on the board.
      className={`inline-flex shrink-0 items-center rounded px-1.5 text-[10px] font-semibold leading-4 tabular-nums ${
        full ? 'bg-red-500/20 text-red-400' : 'bg-ocean-950/60 text-ocean-300'
      }`}
    >
      {count}/{MAX_VEHICLES_PER_ZONE_SIDE}
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
      // The title row is gone entirely — zone number, biome word and all. The
      // number was furniture (players point at zones, they don't name them),
      // and the biome now reads from the panel's own tint and border. Its two
      // useful tenants moved rather than died: the occupancy counts onto the HP
      // rows, the effect markers onto the front line. That is 26px of the
      // board's height back, per panel.
      title={`${zone.biome} zone`}
      className={`flex flex-col gap-1.5 rounded border p-2 ${BIOME_TINT[zone.biome] ?? 'bg-ocean-900/20'} ${
        highlighted
          ? 'cursor-pointer border-brass-400 ring-2 ring-brass-400'
          : BIOME_BORDER[zone.biome] ?? 'border-ocean-600'
      }`}
    >
      {/* Colour alone is not an accessible readout, and the tint is the only
          visible biome cue left. The `title` above covers a hover; this covers
          a screen reader. Neither costs a pixel. */}
      <span className="sr-only">{zone.biome} zone</span>
      {/* Both bases, mirroring the zone's own layout: the enemy above their
          vehicles, yours below yours. Base HP is public state and losing two
          zones loses the game, so a player cannot judge the board without
          seeing how close the opponent's base is to falling. Each carries its
          own side's occupancy count. */}
      <HpBar
        label="Enemy base"
        hp={zone.baseHp[theirSide]}
        max={maxBaseHp}
        own={false}
        badge={<LaneCount count={zone.cards[theirSide].length} mine={false} />}
      />
      <VehicleLane
        // `grow shrink-0`: the two lanes split whatever height the panel has
        // spare, so a tall viewport gives the fleets more room instead of
        // leaving a dead band at the panel's foot. They never shrink, so a
        // short viewport scrolls the board rather than squashing a chip.
        // `content-center` keeps the slot rows centred in the taller box.
        className="grow shrink-0 content-center"
        entries={zone.cards[theirSide] as ZoneCardEntry[]}
        renderEntry={(c) => {
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
        }}
      />
      <FrontLine badges={zoneEffectBadgeList ?? []} />
      <VehicleLane
        className="grow shrink-0 content-center"
        entries={zone.cards[mySide] as ZoneCardEntry[]}
        renderEntry={(c) => {
          const mobileEligible = !!canMoveVehicles && c.keywords.includes(KEYWORDS.MOBILE) && c.movedOnTurn !== turnNumber
          // An activated ability needs `onActivate` plus AT LEAST ONE price.
          // There are two since wave 6 — CP (Braveheart, Judgement) and
          // materials (Victoria) — and a card may carry either or both. This
          // gate must stay in step with ACTIVATE_VEHICLE's own: a card the
          // engine would activate but this rejects has a working ability with
          // no way to press it.
          const meta = c.meta as { activateCpCost?: unknown; activateMaterialCost?: unknown; onActivate?: unknown }
          const activateEligible =
            !!canActivateVehicles &&
            (typeof meta.activateCpCost === 'number' || typeof meta.activateMaterialCost === 'number') &&
            typeof meta.onActivate === 'string' &&
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
        }}
      />
      <HpBar
        label="Your base"
        hp={zone.baseHp[mySide]}
        max={maxBaseHp}
        badge={<LaneCount count={zone.cards[mySide].length} mine />}
      />
      {children && (
        <div onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </section>
  )
}
