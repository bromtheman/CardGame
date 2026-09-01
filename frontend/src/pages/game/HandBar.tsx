import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CardInstance, PublicGameState } from '@shared/engine/gameInit'
import type { GameAction, Side } from '@shared/engine/engineTypes'
import { effectiveCostInGame, effectName, legalZonesFor } from '@shared/engine/index'
import { TRIGGERS } from '@shared/gameSettings'
import { shortHandNumber } from '@shared/format'
import { cardInstanceToRow } from '../../lib/cards'
import { PhysicalCard } from '../../components/PhysicalCard'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { MoveMode, SwapMode } from './HeroPowerBar'
import {
  CARD_H, CARD_W, HAND_RAIL_H, REST_SCALE, fanLayout,
} from './handFanLayout'

// A card "has an effect" if any of its meta trigger keys (or costModifier)
// resolve to a name — used only to decide whether the no-op confirm dialog
// is warranted. Deliberately duplicates shared/effects/registry.ts's
// private (unexported) ALL_META_KEYS = [...Object.values(TRIGGERS),
// 'costModifier'] used by noteUnimplemented — if TRIGGERS ever grows a new
// key there, mirror it here too.
const ALL_TRIGGER_KEYS: string[] = [...Object.values(TRIGGERS), 'costModifier']
function hasAnyMetaEffect(card: CardInstance): boolean {
  return ALL_TRIGGER_KEYS.some((key) => effectName(card, key) !== null)
}

// Excalibur is DP6's hand direction's only customer (spec §4.3, departure
// 4): a vehicle carrying playOnCardEffect whose target must be an AI ship —
// mirrors excaliburEffect's own PoolFilter (shared/effects/ssEffects.ts).
// Checked against the registry name, not the card name, so a rename doesn't
// silently break it. Used only to decide whether to offer the two-step hand
// pick at all; the server re-validates the real target when the action is
// sent. With no legal target this returns false and the vehicle falls
// through to a plain zone play — Excalibur must stay playable with an empty
// hand of AI ships, or a 550k blocker becomes unplayable.
function hasLegalExcaliburTarget(card: CardInstance, hand: CardInstance[]): boolean {
  if (effectName(card, TRIGGERS.PLAY_ON_CARD) !== 'excaliburEffect') return false
  return hand.some((c) => (
    c.instanceId !== card.instanceId && c.type === 'vehicle' && c.vehicleType === 'ship' && c.isBuiltIn
  ))
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
// confirm only when the card has no meta effect at all.
export function HandBar({
  hand, state, mySide, turnNumber, send, busy,
  placingCard, onPlacingChange,
  fieldTargeting, onFieldTargetingChange,
  moveMode,
  onVehicleHandTargetPicked,
  swapMode,
  cancelBoardModes,
  onLiftedChange,
  leading,
  trailing,
}: {
  hand: CardInstance[]
  state: PublicGameState
  mySide: Side
  // legalZonesFor needs it since wave 6: WF Purifier deploys only where its
  // owner lost a battle within the last full round.
  turnNumber: number
  send: (action: GameAction) => Promise<void>
  busy: boolean
  placingCard: CardInstance | null
  onPlacingChange: (card: CardInstance | null) => void
  fieldTargeting: CardInstance | null
  onFieldTargetingChange: (card: CardInstance | null) => void
  moveMode: MoveMode | null
  // Excalibur only (spec §4.3, departure 4): fires once the hand target is
  // chosen, so GameBoardPage can chain into its existing moveMode pickZone
  // phase for the destination zone — a vehicle needs both instanceId and
  // targetInstanceId, unlike an ability's playOnCardEffect.
  onVehicleHandTargetPicked: (instanceId: string, targetInstanceId: string) => void
  swapMode: SwapMode | null
  cancelBoardModes: () => void
  // Fires whenever the hovered/focused card changes, so GameBoardPage can
  // tint the materials readout when the lifted card is unaffordable.
  onLiftedChange: (card: CardInstance | null) => void
  // The rail's two flanks. A five-card fan uses barely half the row, so the
  // ends are dead space that the battle log toggle (left) and End turn /
  // Concede (right) now occupy instead of costing the page their own row.
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const [handTargeting, setHandTargeting] = useState<CardInstance | null>(null)
  const [confirmingNoEffectPlay, setConfirmingNoEffectPlay] = useState<CardInstance | null>(null)

  const [liftedId, setLiftedId] = useState<string | null>(null)
  const fanRef = useRef<HTMLDivElement>(null)
  const [fanWidth, setFanWidth] = useState(0)

  // The fan sizes itself to whatever width it is given, so it must re-measure
  // on resize rather than assume the page's max-width.
  useLayoutEffect(() => {
    const el = fanRef.current
    if (!el) return
    setFanWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setFanWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A lifted card that leaves the hand (played, or discarded by an effect)
  // must not keep the board's affordability tint alive.
  useEffect(() => {
    if (liftedId !== null && !hand.some((c) => c.instanceId === liftedId)) setLiftedId(null)
  }, [hand, liftedId])

  useEffect(() => {
    onLiftedChange(hand.find((c) => c.instanceId === liftedId) ?? null)
  }, [liftedId, hand, onLiftedChange])

  function lift(id: string) {
    setLiftedId(id)
  }
  function drop(id: string) {
    setLiftedId((current) => (current === id ? null : current))
  }

  // Mode exclusivity: whenever one of GameBoardPage's own modes starts, drop
  // our internal handTargeting selection.
  useEffect(() => {
    if (placingCard || fieldTargeting || moveMode || swapMode) setHandTargeting(null)
  }, [placingCard, fieldTargeting, moveMode, swapMode])

  function handleVehicleClick(card: CardInstance) {
    if (placingCard?.instanceId === card.instanceId) {
      onPlacingChange(null)
      return
    }
    if (handTargeting?.instanceId === card.instanceId) {
      setHandTargeting(null)
      return
    }
    if (handTargeting) setHandTargeting(null)

    // Excalibur's hand direction (DP6, spec §4.3 departure 4): offer the
    // two-step pick — hand target first, then a zone — only when a legal
    // target exists. Otherwise fall through to the plain zone play below.
    if (hasLegalExcaliburTarget(card, hand)) {
      cancelBoardModes()
      setHandTargeting(card)
      return
    }

    const legalZones = legalZonesFor(state, mySide, card, turnNumber)
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
      setConfirmingNoEffectPlay(card)
      return
    }
    playAbilityCard(card)
  }

  function playAbilityCard(card: CardInstance) {
    cancelBoardModes()
    setHandTargeting(null)
    void send({ type: 'PLAY_ABILITY_CARD', instanceId: card.instanceId })
  }

  function handleHandTargetClick(target: CardInstance) {
    if (!handTargeting) return
    if (handTargeting.type === 'vehicle') {
      // Excalibur (DP6's hand direction, spec §4.3 departure 4): the hand
      // pick is only step one — a vehicle also needs a destination zone, so
      // chain into GameBoardPage's moveMode instead of sending yet.
      onVehicleHandTargetPicked(handTargeting.instanceId, target.instanceId)
      setHandTargeting(null)
      return
    }
    void send({ type: 'PLAY_CARD_TARGETING_CARD_IN_HAND', instanceId: handTargeting.instanceId, targetInstanceId: target.instanceId })
    setHandTargeting(null)
  }

  // The three targeting modes are mutually exclusive, so at most one hint is
  // ever live. It floats above the rail rather than sitting under it: the rail
  // is a fixed-height row in a page that no longer scrolls, so a hint that
  // took layout height would push the fan up and clip the cards.
  const hint = placingCard
    ? `Choose a highlighted zone for ${placingCard.name}, or click the card again to cancel.`
    : fieldTargeting
      ? `Choose a vehicle on the board to target with ${fieldTargeting.name}, or click its Play button again to cancel.`
      : handTargeting
        ? `Choose another card in hand to target with ${handTargeting.name}, or click it again to cancel.`
        : null

  return (
    <div className="-mx-4 mt-2 flex shrink-0 items-end gap-3">
      {/* The rail is the one full-bleed row on the page — everything above it
          is capped at max-w-6xl. `grow basis-0` makes the two flanks share all
          the leftover viewport, which pushes the controls into the true screen
          corners and keeps the fan centred between them. That distance is the
          point: the fan's outermost cards are rotated by up to ~34°, and a
          rotated card's bounding box is far wider than its face, so it bulges
          ~60px past the fan's own edge. Flanks that merely reserved a button's
          width put End turn underneath that bulge.

          `shrink-0` on the flanks and `min-w-0` on the fan settle who gives way
          on a narrow window: the fan compresses (which it is built to do),
          never the controls. */}
      <div className="flex shrink-0 grow basis-0 items-end justify-start pl-4">{leading}</div>
      <div
        ref={fanRef}
        className="relative w-full min-w-0 max-w-5xl"
        style={{ height: HAND_RAIL_H }}
      >
        {hint && (
          <p className="pointer-events-none absolute inset-x-0 bottom-full z-40 mb-1 text-center text-sm text-brass-400">
            {hint}
          </p>
        )}
        {fanLayout(hand.length, fanWidth).map((slot, i) => {
          const c = hand[i]
          const effectiveCost = effectiveCostInGame(state, mySide, c)
          const affordable = state.resources[mySide].materials >= effectiveCost && state.resources[mySide].cp >= c.cpCost
          const selected =
            placingCard?.instanceId === c.instanceId ||
            fieldTargeting?.instanceId === c.instanceId ||
            handTargeting?.instanceId === c.instanceId ||
            // Excalibur mid-flow (spec §4.3 departure 4): the hand target is
            // already picked and GameBoardPage is now waiting on a zone
            // click, but Excalibur itself is still sitting in this hand.
            (moveMode?.phase === 'pickZone' && moveMode.kind === 'handTarget' && moveMode.instanceId === c.instanceId)
          const isHandTarget = handTargeting !== null && c.instanceId !== handTargeting.instanceId
          const lifted = liftedId === c.instanceId
          return (
            <div
              key={c.instanceId}
              tabIndex={0}
              onPointerEnter={() => lift(c.instanceId)}
              // A touch tap fires pointerenter -> pointerdown -> focus -> pointerup
              // -> pointerleave all within the same tap, so an unconditional drop()
              // here would lift and immediately drop the card before the Play/Target
              // buttons (gated on `lifted`) ever render — no ability card could be
              // played on touch. Only a real mouse should drop on pointerleave;
              // touch and keyboard rely on onBlur below instead. Do not "simplify"
              // this back to an unconditional drop.
              onPointerLeave={(e) => { if (e.pointerType === 'mouse') drop(c.instanceId) }}
              onFocus={() => lift(c.instanceId)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) drop(c.instanceId)
              }}
              style={{
                left: slot.left,
                // The lift must NEVER translate this card. `bottom` stays on the
                // resting arc and the rise comes purely from scaling about
                // `bottom center`, which grows the card upward while pinning its
                // bottom edge. Translating up instead moved the card's bottom
                // edge out from under a cursor hovering near it: the card left
                // the pointer, pointerleave dropped it, it fell back under the
                // pointer, pointerenter lifted it again — a flicker loop, and
                // with two overlapping cards they alternated. Scaling from a
                // fixed origin cannot do that, because every point inside the
                // resting card is still inside the grown one.
                bottom: slot.bottom,
                width: CARD_W,
                height: CARD_H,
                zIndex: lifted ? 50 : i,
                transform: `scale(${lifted ? 1 : REST_SCALE}) rotate(${lifted ? 0 : slot.angleDeg}deg)`,
                transformOrigin: 'bottom center',
              }}
              // Unaffordable cards are marked with a red ring and a red cost
              // badge, never by dimming: cards overlap in the fan, so a
              // translucent card shows the one behind it through its face.
              // Selection wins the ring — a vehicle can enter placing mode
              // while unaffordable, and the server rejects it on play.
              className={`absolute rounded-xl transition-all duration-150 ease-out focus:outline-none ${
                selected ? 'ring-4 ring-brass-400' : affordable ? '' : 'ring-2 ring-red-400'
              }`}
            >
              {/* In an active game a card press ACTS — deploy the vehicle, play
                  the ability — for both card types alike; details move to the
                  corner button PhysicalCard renders whenever onClick is given.
                  Elsewhere (deck builder, collection, create-card preview) no
                  onClick is passed, so a press inspects instead.

                  This is also what makes the hand usable on touch. A tap fires
                  pointerenter (lift) and click together; if the press only
                  inspected, the portalled details modal would autoFocus, blur
                  the card, drop the lift, and unmount the Play button before it
                  could ever be tapped. */}
              <PhysicalCard
                card={cardInstanceToRow(c)}
                effectiveCost={effectiveCost}
                unaffordable={!affordable}
                // The wrapper above owns the hover animation and draws the
                // unaffordable ring. A second lift on the face itself would
                // slide the card out of that ring.
                hoverLift={false}
                onClick={
                  c.type === 'vehicle'
                    ? () => handleVehicleClick(c)
                    : () => { if (!busy && affordable) handleAbilityPlay(c) }
                }
              />
              {effectiveCost !== c.materialCost && (
                <span
                  className={`absolute bottom-3 left-3 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-parchment-100 ${
                    affordable ? 'bg-ocean-900/90' : 'bg-red-700/90'
                  }`}
                >
                  <span className="text-ocean-300 line-through">{shortHandNumber(c.materialCost)}</span>
                  <span>{shortHandNumber(effectiveCost)}</span>
                </span>
              )}
              {/* Actions render only on the lifted card: in a fan every other
                  card's buttons are covered by its neighbour, and rendering
                  them anyway would put unreachable controls in the tab order. */}
              {lifted && isHandTarget && (
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
              {lifted && c.type === 'ability' && (
                <button
                  disabled={busy || !affordable}
                  onClick={() => handleAbilityPlay(c)}
                  className="absolute inset-x-6 bottom-6 rounded bg-brass-400 px-2 py-2 font-bold text-ocean-950 shadow-plank disabled:opacity-50"
                >
                  Play ({shortHandNumber(effectiveCost)})
                </button>
              )}
            </div>
          )
        })}
        {hand.length === 0 && (
          <p className="absolute inset-x-0 bottom-8 text-center text-ocean-300">Your hand is empty.</p>
        )}
      </div>
      <div className="flex shrink-0 grow basis-0 items-end justify-end pr-4">{trailing}</div>
      <ConfirmDialog
        open={confirmingNoEffectPlay !== null}
        title={`Play ${confirmingNoEffectPlay?.name ?? ''}?`}
        body="It has no effect — this only spends the card."
        confirmLabel="Play it"
        onConfirm={() => {
          if (confirmingNoEffectPlay) playAbilityCard(confirmingNoEffectPlay)
          setConfirmingNoEffectPlay(null)
        }}
        onCancel={() => setConfirmingNoEffectPlay(null)}
      />
    </div>
  )
}
