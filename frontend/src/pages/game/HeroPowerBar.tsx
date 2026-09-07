import { useState } from 'react'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side } from '@shared/engine/engineTypes'
import { battleFrozen } from '@shared/engine/index'
import { HERO_POWER_DISTANCE_MOD_M, VEHICLE_TYPES } from '@shared/gameSettings'
import { PromptDialog } from '../../components/ConfirmDialog'

// Move-mode shared between Rapid Redeployment (pick any own vehicle, then a
// legal zone), the mobile-vehicle "move" affordance on MiniVehicle (skips
// straight to picking a zone for that one vehicle), and Excalibur's hand
// direction (DP6, spec §4.3 departure 4) — HandBar picks the hand target
// first, then chains into this same pickZone phase for the destination,
// carrying that target alongside the vehicle's own instanceId since
// PLAY_CARD_TARGETING_CARD_IN_HAND needs both. GameBoardPage owns the actual
// state; this type just describes its shape for both consumers.
//
// `pickVehicle` carries a `kind` because SS Counter Intelligence shares its
// pick-an-own-vehicle step and then SENDS on that first click, where Rapid
// Redeployment chains into pickZone.
export type MoveMode =
  | { phase: 'pickVehicle'; kind: 'rapidRedeployment' | 'counterIntelligence' }
  | { phase: 'pickZone'; instanceId: string; kind: 'mobile' | 'heroPower' | 'activate' }
  | { phase: 'pickZone'; instanceId: string; kind: 'handTarget'; targetInstanceId: string }

// Swap-mode for the DWG faction power (Boarding Party): pick one of my DWG
// ships on the board, then an enemy ship in the same zone. GameBoardPage
// owns the actual state; mirrors MoveMode's shape.
export type SwapMode = { phase: 'pickOwn' } | { phase: 'pickEnemy'; ownInstanceId: string }

type UniversalPower = 'salvage' | 'tacticalPositioning' | 'draw' | 'rapidRedeployment'
type FactionPower =
  | 'boardingParty' | 'changeOrder' | 'flyby'
  | 'counterIntelligence' | 'drones' | 'flankingManeuver'

// power → faction that alone may use it, plus display info. Matches the
// seeded hero_powers rows — display-only, no fetch (mirrors
// shared/engine/heroPowers.ts's FACTION_POWERS map). GT has no faction power
// authored, so a GT deck renders only the four universal buttons.
const FACTION_POWER_INFO: Record<string, { power: FactionPower; label: string; blurb: string }> = {
  DWG: { power: 'boardingParty', label: 'Boarding Party', blurb: 'Exchange a friendly DWG ship with an enemy ship of equal or lesser cost in the same zone' },
  OW: { power: 'changeOrder', label: 'Change Order', blurb: 'Discard an OW vehicle; draw a player-made ship or tank from your deck in two turns' },
  LH: { power: 'flyby', label: 'Flyby', blurb: 'Give an LH vehicle card in hand Half-Cost and Temporary' },
  SS: { power: 'counterIntelligence', label: 'Counter Intelligence', blurb: 'Give one of your vehicles on the board Air Screen and Sub Screen' },
  TG: { power: 'drones', label: 'Drones', blurb: 'Spawn a Temporary Mirth Swarm into every zone' },
  WF: { power: 'flankingManeuver', label: 'Flanking Maneuver', blurb: 'Choose a zone: your next fleet attack there this turn deploys after the defender, and every enemy vehicle counts as Fragile for that battle' },
}

// Header strip for the 4 universal hero powers (once-per-game, 1 CP each).
// Salvage opens an inline picker of my destroyed vehicles. Tactical
// Positioning also has a dedicated distance-nudge UI on BattleOverlay's
// spawn sheet; this button is a same-effect fallback via a prompt. Rapid
// Redeployment starts move-mode — GameBoardPage highlights legal zones on
// the board once a vehicle is picked.
export function HeroPowerBar({
  state, mySide, isMyTurn, isActive, send, busy, hand,
  moveMode, onStartRapidRedeployment, onStartCounterIntelligence, onCancelMove,
  swapMode, onStartBoardingParty, onCancelSwap,
  flankMode, onStartFlankingManeuver, onCancelFlank,
}: {
  state: PublicGameState
  mySide: Side
  isMyTurn: boolean
  isActive: boolean
  send: (action: GameAction) => Promise<void>
  busy: boolean
  hand: CardInstance[]
  moveMode: MoveMode | null
  onStartRapidRedeployment: () => void
  onCancelMove: () => void
  swapMode: SwapMode | null
  onStartBoardingParty: () => void
  onCancelSwap: () => void
  // SS Counter Intelligence: pick one of my vehicles on the board (moveMode's
  // pickVehicle phase, kind 'counterIntelligence').
  onStartCounterIntelligence: () => void
  // WF Flanking Maneuver: pick a zone — every zone highlights while armed.
  flankMode: boolean
  onStartFlankingManeuver: () => void
  onCancelFlank: () => void
}) {
  const [salvageOpen, setSalvageOpen] = useState(false)
  const [factionPickerOpen, setFactionPickerOpen] = useState(false)
  const [tacticalPromptOpen, setTacticalPromptOpen] = useState(false)
  const myDestroyedVehicles = state.destroyed[mySide].filter((c) => c.type === 'vehicle')

  function reasonFor(power: UniversalPower | FactionPower): string | null {
    if (!isActive) return 'Game is over'
    if (state.usedHeroPowers[mySide].includes(power)) return 'Already used this game'
    if (state.resources[mySide].cp < 1) return 'Not enough CP'
    if (power === 'tacticalPositioning') {
      if (!state.activeBattle) return 'No battle to reposition'
      if (state.pendingReport) return 'Resolve the pending report first'
      if (state.activeBattle.distanceModifiedBy.includes(mySide)) return 'You already adjusted this battle'
      return null
    }
    if (!isMyTurn) return 'Not your turn'
    if (battleFrozen(state)) return 'Resolve the battle first'
    if (power === 'salvage' && myDestroyedVehicles.length === 0) return 'No destroyed vehicles to salvage'
    return null
  }

  const reasons: Record<UniversalPower, string | null> = {
    salvage: reasonFor('salvage'),
    tacticalPositioning: reasonFor('tacticalPositioning'),
    draw: reasonFor('draw'),
    rapidRedeployment: reasonFor('rapidRedeployment'),
  }

  // Faction power: absent for NEUTRAL/GT (nothing renders). boardingParty and
  // counterIntelligence pick on the board (swapMode / moveMode); flanking picks
  // a zone (flankMode); drones sends at once like Draw; changeOrder/flyby pick
  // from an inline hand-card dropdown, same pattern as Salvage's.
  const factionPowerInfo = FACTION_POWER_INFO[state.factions[mySide]]
  const hasOwnDwgShip = state.zones.some((z) => z.cards[mySide].some((c) => c.faction === 'DWG' && c.vehicleType === VEHICLE_TYPES.SHIP))
  const hasOwnVehicle = state.zones.some((z) => z.cards[mySide].length > 0)
  const eligibleFactionCards: CardInstance[] =
    factionPowerInfo?.power === 'changeOrder'
      ? hand.filter((c) => c.faction === 'OW' && c.type === 'vehicle')
      : factionPowerInfo?.power === 'flyby'
        ? hand.filter((c) => c.faction === 'LH' && c.type === 'vehicle')
        : []
  const factionReason = factionPowerInfo
    ? (reasonFor(factionPowerInfo.power) ??
        (factionPowerInfo.power === 'boardingParty' && !hasOwnDwgShip
          ? 'No DWG ship on the board'
          : factionPowerInfo.power === 'changeOrder' && eligibleFactionCards.length === 0
            ? 'No OW vehicle in hand'
            : factionPowerInfo.power === 'flyby' && eligibleFactionCards.length === 0
              ? 'No LH vehicle in hand'
              : factionPowerInfo.power === 'counterIntelligence' && !hasOwnVehicle
                ? 'No vehicle of yours on the board'
                : null))
    : null
  // A board-pick power stays clickable while its own mode is armed, so the
  // same button cancels it.
  const counterIntelActive = moveMode?.phase === 'pickVehicle' && moveMode.kind === 'counterIntelligence'
  const factionModeActive =
    factionPowerInfo?.power === 'boardingParty' ? !!swapMode
      : factionPowerInfo?.power === 'counterIntelligence' ? counterIntelActive
        : factionPowerInfo?.power === 'flankingManeuver' ? flankMode
          : false
  const factionDisabled = busy || (!!factionReason && !factionModeActive)

  async function onDraw() {
    await send({ type: 'USE_HERO_POWER', power: 'draw' })
  }

  function onTacticalFromHeader() {
    setTacticalPromptOpen(true)
  }

  async function onTacticalConfirm(raw: string) {
    setTacticalPromptOpen(false)
    const parsed = Number(raw)
    const delta = Math.max(-HERO_POWER_DISTANCE_MOD_M, Math.min(HERO_POWER_DISTANCE_MOD_M, Number.isNaN(parsed) ? 0 : parsed))
    if (delta === 0) return
    await send({ type: 'USE_HERO_POWER', power: 'tacticalPositioning', distanceDeltaM: delta })
  }

  async function onSalvage(cardId: string) {
    await send({ type: 'USE_HERO_POWER', power: 'salvage', cardId })
    setSalvageOpen(false)
  }

  function onRapidRedeploymentClick() {
    if (moveMode) onCancelMove()
    else onStartRapidRedeployment()
  }

  function onFactionButtonClick() {
    if (!factionPowerInfo) return
    switch (factionPowerInfo.power) {
      case 'boardingParty':
        if (swapMode) onCancelSwap()
        else onStartBoardingParty()
        return
      case 'counterIntelligence':
        if (counterIntelActive) onCancelMove()
        else onStartCounterIntelligence()
        return
      case 'flankingManeuver':
        if (flankMode) onCancelFlank()
        else onStartFlankingManeuver()
        return
      case 'drones':
        void send({ type: 'USE_HERO_POWER', power: 'drones' })
        return
      default:
        setFactionPickerOpen((v) => !v)
    }
  }

  async function onPickFactionCard(instanceId: string) {
    if (!factionPowerInfo) return
    await send({ type: 'USE_HERO_POWER', power: factionPowerInfo.power, instanceId })
    setFactionPickerOpen(false)
  }

  return (
    // shrink-0: this is fixed chrome in GameBoardPage's column, and must not
    // be squeezed when the board wants room.
    <div className="mx-auto mt-2 flex w-full max-w-6xl shrink-0 flex-wrap items-center gap-2 rounded border border-ocean-600 bg-ocean-900/40 px-2 py-1">
      <span className="text-xs font-bold uppercase tracking-wide text-ocean-300">Hero powers</span>

      <div className="relative">
        <button
          disabled={busy || !!reasons.salvage}
          title={reasons.salvage ?? 'Return a destroyed vehicle to your hand'}
          onClick={() => setSalvageOpen((v) => !v)}
          className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvage (1 CP)
        </button>
        {/* Opens UPWARD over the board. The bar sits below the board now, so a
            `top-full` popover would drop into the hand rail and be cut off by
            the page's `overflow-clip`. Same for the faction picker below. */}
        {salvageOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-56 overflow-y-auto rounded border border-brass-400 bg-ocean-900 p-2 shadow-plank">
            {myDestroyedVehicles.length === 0 && <p className="text-xs text-ocean-300">No destroyed vehicles.</p>}
            {myDestroyedVehicles.map((c, i) => (
              <button
                key={`${c.cardId}-${i}`}
                disabled={busy}
                onClick={() => onSalvage(c.cardId)}
                className="block w-full rounded px-2 py-1 text-left text-sm text-parchment-100 hover:bg-ocean-800 disabled:opacity-50"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        disabled={busy || !!reasons.tacticalPositioning}
        title={reasons.tacticalPositioning ?? "Adjust the active battle's spawn distance"}
        onClick={onTacticalFromHeader}
        className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Tactical Positioning (1 CP)
      </button>

      <button
        disabled={busy || !!reasons.draw}
        title={reasons.draw ?? 'Draw a card'}
        onClick={onDraw}
        className="rounded border border-ocean-600 px-3 py-1 text-sm font-bold text-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Hero Power Draw (1 CP)
      </button>

      <button
        disabled={busy || (!!reasons.rapidRedeployment && !moveMode)}
        title={reasons.rapidRedeployment ?? 'Move a friendly vehicle to any other zone legal for it'}
        onClick={onRapidRedeploymentClick}
        className={`rounded border px-3 py-1 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
          moveMode ? 'border-brass-400 bg-brass-400/20 text-brass-400' : 'border-ocean-600 text-parchment-100'
        }`}
      >
        Rapid Redeployment (1 CP)
      </button>

      {factionPowerInfo && (
        <div className="relative">
          <button
            disabled={factionDisabled}
            title={factionReason ?? factionPowerInfo.blurb}
            onClick={onFactionButtonClick}
            className={`rounded border px-3 py-1 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
              factionModeActive ? 'border-brass-400 bg-brass-400/20 text-brass-400' : 'border-ocean-600 text-parchment-100'
            }`}
          >
            {factionPowerInfo.label} (1 CP)
          </button>
          {factionPickerOpen && (factionPowerInfo.power === 'changeOrder' || factionPowerInfo.power === 'flyby') && (
            <div className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-64 overflow-y-auto rounded border border-brass-400 bg-ocean-900 p-2 shadow-plank">
              {eligibleFactionCards.length === 0 && <p className="text-xs text-ocean-300">No eligible cards in hand.</p>}
              {eligibleFactionCards.map((c) => (
                <button
                  key={c.instanceId}
                  disabled={busy}
                  onClick={() => onPickFactionCard(c.instanceId)}
                  className="block w-full rounded px-2 py-1 text-left text-sm text-parchment-100 hover:bg-ocean-800 disabled:opacity-50"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {moveMode && (
        <span className="ml-auto flex items-center gap-2 text-sm text-brass-400">
          {moveMode.phase === 'pickVehicle'
            ? (moveMode.kind === 'counterIntelligence'
                ? 'Pick one of your vehicles on the board to screen…'
                : 'Pick one of your vehicles on the board to redeploy…')
            : 'Choose a highlighted zone, or cancel.'}
          <button onClick={onCancelMove} className="rounded border border-ocean-600 px-2 py-0.5 text-xs text-parchment-100">
            Cancel
          </button>
        </span>
      )}

      {flankMode && (
        <span className="ml-auto flex items-center gap-2 text-sm text-brass-400">
          Pick the zone to flank, or cancel.
          <button onClick={onCancelFlank} className="rounded border border-ocean-600 px-2 py-0.5 text-xs text-parchment-100">
            Cancel
          </button>
        </span>
      )}

      {swapMode && (
        <span className="ml-auto flex items-center gap-2 text-sm text-brass-400">
          {swapMode.phase === 'pickOwn'
            ? 'Pick one of your DWG ships on the board to trade…'
            : 'Choose an enemy ship in the same zone, or cancel.'}
          <button onClick={onCancelSwap} className="rounded border border-ocean-600 px-2 py-0.5 text-xs text-parchment-100">
            Cancel
          </button>
        </span>
      )}

      <PromptDialog
        open={tacticalPromptOpen}
        title="Tactical Positioning"
        body={`Adjust the active battle's spawn distance by up to ±${HERO_POWER_DISTANCE_MOD_M}m.`}
        confirmLabel="Adjust"
        inputType="number"
        placeholder="0"
        onConfirm={(value) => void onTacticalConfirm(value)}
        onCancel={() => setTacticalPromptOpen(false)}
      />
    </div>
  )
}
