import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side } from '@shared/engine/engineTypes'
import { canAfford, effectiveMaterialCostOf, legalZonesFor } from '@shared/engine/index'
import { KEYWORDS } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import type { CardRow } from '../../lib/cards'
import { PhysicalCard } from '../../components/PhysicalCard'

function instanceToCardRow(c: CardInstance): CardRow {
  return {
    id: c.instanceId, name: c.name, is_built_in: c.isBuiltIn, owner_id: c.ownerId,
    faction: c.faction, type: c.type, vehicle_type: c.vehicleType,
    blueprint_cost: c.blueprintCost, material_cost: c.materialCost, cp_cost: c.cpCost,
    card_text: c.cardText, image_url: c.imageUrl,
    keywords: c.keywords, meta: c.meta, created_at: '',
  } as CardRow
}

// Horizontal hand of full PhysicalCards. Vehicles: click plays immediately
// when exactly one zone is legal, otherwise enters "placing" mode so
// GameBoardPage can highlight legal BoardZones. Abilities: a Play button
// (with a confirm — effects aren't implemented until Phase 5).
export function HandBar({
  hand, state, mySide, send, busy, placingCard, onPlacingChange,
}: {
  hand: CardInstance[]
  state: PublicGameState
  mySide: Side
  send: (action: GameAction) => Promise<void>
  busy: boolean
  placingCard: CardInstance | null
  onPlacingChange: (card: CardInstance | null) => void
}) {
  function handleVehicleClick(card: CardInstance) {
    if (placingCard?.instanceId === card.instanceId) {
      onPlacingChange(null)
      return
    }
    const legalZones = legalZonesFor(state, mySide, card)
    if (legalZones.length === 1) {
      onPlacingChange(null)
      void send({ type: 'PLAY_CARD_TO_ZONE', instanceId: card.instanceId, zoneId: legalZones[0] })
      return
    }
    onPlacingChange(card)
  }

  function handleAbilityPlay(card: CardInstance) {
    const ok = window.confirm(
      `Play "${card.name}"? Ability effects arrive in Phase 5 — for now this only spends the card and its cost.`,
    )
    if (!ok) return
    onPlacingChange(null)
    void send({ type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
  }

  return (
    <div className="mt-4">
      <h2 className="font-display text-xl">Your hand</h2>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-4">
        {hand.map((c) => {
          const affordable = canAfford(state, mySide, c)
          const selected = placingCard?.instanceId === c.instanceId
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
              {c.keywords.includes(KEYWORDS.HALF_COST) && (
                <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-ocean-900/90 px-2 py-1 text-xs font-bold text-parchment-100">
                  <span className="text-ocean-300 line-through">{shortHandNumber(c.materialCost)}</span>
                  <span>{shortHandNumber(effectiveMaterialCostOf(c))}</span>
                </span>
              )}
              {c.type === 'ability' && (
                <button
                  disabled={busy || !affordable}
                  onClick={() => handleAbilityPlay(c)}
                  className="absolute inset-x-6 bottom-6 rounded bg-brass-400 px-2 py-2 font-bold text-ocean-950 shadow-plank disabled:opacity-50"
                >
                  Play ({shortHandNumber(effectiveMaterialCostOf(c))})
                </button>
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
    </div>
  )
}
