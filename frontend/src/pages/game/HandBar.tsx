import { useEffect, useState } from 'react'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side } from '@shared/engine/engineTypes'
import { effectiveCostInGame, effectName, legalZonesFor } from '@shared/engine/index'
import { TRIGGERS } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import type { CardRow } from '../../lib/cards'
import { PhysicalCard } from '../../components/PhysicalCard'
import type { MoveMode } from './HeroPowerBar'

function instanceToCardRow(c: CardInstance): CardRow {
  return {
    id: c.instanceId, name: c.name, is_built_in: c.isBuiltIn, owner_id: c.ownerId,
    faction: c.faction, type: c.type, vehicle_type: c.vehicleType,
    blueprint_cost: c.blueprintCost, material_cost: c.materialCost, cp_cost: c.cpCost,
    card_text: c.cardText, image_url: c.imageUrl,
    keywords: c.keywords, meta: c.meta, created_at: '',
  } as CardRow
}

// A card "has an effect" if any of its meta trigger keys (or costModifier)
// resolve to a name — mirrors registry.ts's noteUnimplemented/ALL_META_KEYS,
// used only to decide whether the no-op confirm dialog is warranted.
const ALL_TRIGGER_KEYS: string[] = [...Object.values(TRIGGERS), 'costModifier']
function hasAnyMetaEffect(card: CardInstance): boolean {
  return ALL_TRIGGER_KEYS.some((key) => effectName(card, key) !== null)
}

// Horizontal hand of full PhysicalCards.
//
// Vehicles: click plays immediately when exactly one zone is legal,
// otherwise enters "placing" mode so GameBoardPage can highlight legal
// BoardZones.
//
// Abilities: a Play button whose click behavior depends on the card's meta
// trigger (checked in order): playOnZoneEffect enters placing mode (with
// every zone legal — GameBoardPage handles that distinction);
// playOnVehicleEffect enters GameBoardPage's fieldTargeting mode (click any
// vehicle on the board); playOnCardEffect enters this component's own
// handTargeting mode (click another hand card's Target button); with none
// of those it sends PLAY_ABILITY_CARD directly, falling back to a plain
// confirm only when the card has no meta effect at all. A small secondary
// Reveal button sends SET_ALERT_CARD to show the card as an in-progress
// effect.
export function HandBar({
  hand, state, mySide, send, busy,
  placingCard, onPlacingChange,
  fieldTargeting, onFieldTargetingChange,
  moveMode,
  cancelBoardModes,
}: {
  hand: CardInstance[]
  state: PublicGameState
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
  placingCard: CardInstance | null
  onPlacingChange: (card: CardInstance | null) => void
  fieldTargeting: CardInstance | null
  onFieldTargetingChange: (card: CardInstance | null) => void
  moveMode: MoveMode | null
  cancelBoardModes: () => void
}) {
  const [handTargeting, setHandTargeting] = useState<CardInstance | null>(null)

  // Mode exclusivity: whenever one of GameBoardPage's own modes starts, drop
  // our internal handTargeting selection.
  useEffect(() => {
    if (placingCard || fieldTargeting || moveMode) setHandTargeting(null)
  }, [placingCard, fieldTargeting, moveMode])

  function handleVehicleClick(card: CardInstance) {
    if (placingCard?.instanceId === card.instanceId) {
      onPlacingChange(null)
      return
    }
    if (handTargeting) setHandTargeting(null)
    const legalZones = legalZonesFor(state, mySide, card)
    if (legalZones.length === 1) {
      cancelBoardModes()
      void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: legalZones[0] })
      return
    }
    onPlacingChange(card)
  }

  function handleAbilityPlay(card: CardInstance) {
    // Click-again-to-cancel, whichever mode this card is currently driving.
    if (placingCard?.instanceId === card.instanceId) {
      onPlacingChange(null)
      return
    }
    if (fieldTargeting?.instanceId === card.instanceId) {
      onFieldTargetingChange(null)
      return
    }
    if (handTargeting?.instanceId === card.instanceId) {
      setHandTargeting(null)
      return
    }

    if (effectName(card, TRIGGERS.PLAY_ON_ZONE) !== null) {
      onPlacingChange(card)
      return
    }
    if (effectName(card, TRIGGERS.PLAY_ON_VEHICLE) !== null) {
      onFieldTargetingChange(card)
      return
    }
    if (effectName(card, TRIGGERS.PLAY_ON_CARD) !== null) {
      cancelBoardModes()
      setHandTargeting(card)
      return
    }

    if (!hasAnyMetaEffect(card)) {
      const ok = window.confirm(`Play "${card.name}"? It has no effect — this only spends the card.`)
      if (!ok) return
    }
    cancelBoardModes()
    void send({ type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
  }

  function handleReveal(card: CardInstance) {
    void send({ type: 'SET_ALERT_CARD', instanceId: card.instanceId })
  }

  function handleHandTargetClick(target: CardInstance) {
    if (!handTargeting) return
    void send({ type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: handTargeting.instanceId, targetInstanceId: target.instanceId })
    setHandTargeting(null)
  }

  return (
    <div className="mt-4">
      <h2 className="font-display text-xl">Your hand</h2>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-4">
        {hand.map((c) => {
          const effectiveCost = effectiveCostInGame(state, mySide, c)
          const affordable = state.resources[mySide].materials >= effectiveCost && state.resources[mySide].cp >= c.cpCost
          const selected =
            placingCard?.instanceId === c.instanceId ||
            fieldTargeting?.instanceId === c.instanceId ||
            handTargeting?.instanceId === c.instanceId
          const isHandTarget = handTargeting !== null && c.instanceId !== handTargeting.instanceId
          return (
            <div
              key={c.instanceId}
              className={`relative shrink-0 origin-top-left scale-75 ${affordable ? '' : 'opacity-50'} ${
                selected ? 'rounded-xl ring-4 ring-brass-400' : ''
              }`}
            >
              <PhysicalCard
                card={instanceToCardRow(c)}
                onClick={c.type === 'vehicle' ? () => handleVehicleClick(c) : undefined}
              />
              {effectiveCost !== c.materialCost && (
                <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-ocean-900/90 px-2 py-1 text-xs font-bold text-parchment-100">
                  <span className="text-ocean-300 line-through">{shortHandNumber(c.materialCost)}</span>
                  <span>{shortHandNumber(effectiveCost)}</span>
                </span>
              )}
              {isHandTarget && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleHandTargetClick(c)
                  }}
                  className="absolute inset-x-6 top-16 rounded bg-ocean-700 px-2 py-1 text-sm font-bold text-parchment-100 shadow-plank disabled:opacity-50"
                >
                  Target
                </button>
              )}
              {c.type === 'ability' && (
                <>
                  <button
                    type="button"
                    title="Show this card to your opponent as an in-progress effect"
                    disabled={busy}
                    onClick={() => handleReveal(c)}
                    className="absolute inset-x-6 bottom-16 rounded border border-ocean-600 bg-ocean-900/80 px-2 py-1 text-xs font-bold text-parchment-100 disabled:opacity-50"
                  >
                    Reveal
                  </button>
                  <button
                    disabled={busy || !affordable}
                    onClick={() => handleAbilityPlay(c)}
                    className="absolute inset-x-6 bottom-6 rounded bg-brass-400 px-2 py-2 font-bold text-ocean-950 shadow-plank disabled:opacity-50"
                  >
                    Play ({shortHandNumber(effectiveCost)})
                  </button>
                </>
              )}
            </div>
          )
        })}
        {hand.length === 0 && <p className="text-ocean-300">Your hand is empty.</p>}
      </div>
      {placingCard && (
        <p className="mt-1 text-sm text-brass-400">
          Choose a highlighted zone for {placingCard.name}, or click the card again to cancel.
        </p>
      )}
      {fieldTargeting && (
        <p className="mt-1 text-sm text-brass-400">
          Choose a vehicle on the board to target with {fieldTargeting.name}, or click its Play button again to cancel.
        </p>
      )}
      {handTargeting && (
        <p className="mt-1 text-sm text-brass-400">
          Choose another card in hand to target with {handTargeting.name}, or click its Play button again to cancel.
        </p>
      )}
    </div>
  )
}
