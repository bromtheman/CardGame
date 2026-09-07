import {
  CHANGE_ORDER_DELAY_TURNS, HERO_POWER_DISTANCE_MOD_M, KEYWORDS,
  SPAWN_DISTANCE_MAX_M, SPAWN_DISTANCE_MIN_M,
} from '../gameSettings.ts'
import type { ApplyResult, EngineContext, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import {
  battleFrozen, discardCard, drawCard, err, findVehicle, otherSide, putInHand, registerHandler, zoneById,
} from './gameEngine.ts'
import { biomeAllows, effectiveMaterialCostOf } from './placement.ts'
import { zoneCapFor } from './zoneCapacity.ts'
import { catalogCard, spawnInto } from '../effects/primitives.ts'

// power → faction that alone may use it. Powers absent from this map (the
// four universal ones) are open to any faction.
const FACTION_POWERS: Record<
  'boardingParty' | 'changeOrder' | 'flyby' | 'counterIntelligence' | 'drones' | 'flankingManeuver', string
> = {
  boardingParty: 'DWG', changeOrder: 'OW', flyby: 'LH',
  counterIntelligence: 'SS', drones: 'TG', flankingManeuver: 'WF',
}

// Powers that mint from ctx.catalog. game-action loads the catalog only when
// something asks for it, and its usual probe scans card METAS for
// CATALOG_EFFECTS members — a hero power has no card and no meta, so it
// declares its need here instead, and game-action reads this set. The same
// trap as a rider effect's { needsCatalog: true }: without it, every unit test
// passes against makeCtx's hand-built catalog while production 400s.
export const CATALOG_HERO_POWERS: ReadonlySet<string> = new Set(['drones'])

// The registry name Flanking Maneuver's zone rider is filed under, and the
// data flag the engine reads off it. A hero power has no card, so the rider
// is NOT dispatched through the effect registry (fireRider mints its payload
// card from the catalog by cardName, which would need a fake card). The
// engine reads `data.flanking` at battle lock as a plain rule instead — the
// same shape as `blocksFaction` and `drawOnExpiry`. The name is still unique
// so a badge (zoneEffectBadges.ts) can key off it.
export const FLANKING_MANEUVER_EFFECT = 'flankingManeuverEffect'
export const FLANKING_MANEUVER_NAME = 'Flanking Maneuver'

// DWG: swap one of my DWG ships for a same-zone enemy ship that costs no
// more (at EFFECTIVE cost — Half-Cost and future modifiers included) than
// mine. Both hulls are re-stamped as freshly deployed on their new side.
function boardingParty(
  game: EngineGame, actor: Side, instanceId: string | undefined, targetInstanceId: string | undefined,
): ApplyResult {
  if (typeof instanceId !== 'string' || typeof targetInstanceId !== 'string') {
    return err(400, 'Boarding Party needs a ship of mine and an enemy target')
  }
  const mine = findVehicle(game.state, instanceId)
  if (!mine || mine.side !== actor || mine.entry.faction !== 'DWG' || mine.entry.vehicleType !== 'ship') {
    return err(400, 'You must select your own DWG ship')
  }
  const theirs = findVehicle(game.state, targetInstanceId)
  if (!theirs || theirs.side !== otherSide(actor) || theirs.entry.vehicleType !== 'ship') {
    return err(400, 'The target must be an enemy ship')
  }
  if (theirs.zone.id !== mine.zone.id) return err(400, 'The enemy ship must be in the same zone as yours')
  if (effectiveMaterialCostOf(theirs.entry) > effectiveMaterialCostOf(mine.entry)) {
    return err(400, 'That enemy ship costs more than yours')
  }
  const zone = mine.zone
  const enemySide = otherSide(actor)
  zone.cards[actor] = zone.cards[actor].filter((c) => c.instanceId !== instanceId)
  zone.cards[enemySide] = zone.cards[enemySide].filter((c) => c.instanceId !== targetInstanceId)
  const flippedMine: ZoneCardEntry = {
    ...mine.entry, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
  const flippedTheirs: ZoneCardEntry = {
    ...theirs.entry, playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
  zone.cards[enemySide].push(flippedMine)
  zone.cards[actor].push(flippedTheirs)
  game.state.log.push(`Boarding Party: ${mine.entry.name} traded for ${theirs.entry.name}`)
  return { ok: true, game }
}

// OW: scrap an OW vehicle from hand now, get a replacement pulled from deck
// CHANGE_ORDER_DELAY_TURNS later (processed by endTurn in gameEngine.ts).
function changeOrder(game: EngineGame, actor: Side, instanceId: string | undefined): ApplyResult {
  if (typeof instanceId !== 'string') return err(400, 'Change Order needs a card in hand')
  const hand = game.privates[actor].hand
  const index = hand.findIndex((c) => c.instanceId === instanceId)
  if (index < 0) return err(400, 'That card is not in your hand')
  const card = hand[index]
  if (card.faction !== 'OW' || card.type !== 'vehicle') {
    return err(400, 'Change Order requires an OW vehicle in hand')
  }
  hand.splice(index, 1)
  game.state.counts[actor].hand = hand.length
  discardCard(game, actor, card)
  game.state.scheduled.push({
    type: 'changeOrderDraw', side: actor, dueTurn: game.turnNumber + CHANGE_ORDER_DELAY_TURNS,
  })
  game.state.log.push(`${card.name} sent back on a Change Order — replacement inbound`)
  return { ok: true, game }
}

// LH: mark an LH vehicle in hand as a fast, disposable strike craft.
function flyby(game: EngineGame, actor: Side, instanceId: string | undefined): ApplyResult {
  if (typeof instanceId !== 'string') return err(400, 'Flyby needs a card in hand')
  const card = game.privates[actor].hand.find((c) => c.instanceId === instanceId)
  if (!card) return err(400, 'That card is not in your hand')
  if (card.faction !== 'LH' || card.type !== 'vehicle') {
    return err(400, 'Flyby requires an LH vehicle in hand')
  }
  if (!card.keywords.includes(KEYWORDS.HALF_COST)) card.keywords.push(KEYWORDS.HALF_COST)
  if (!card.keywords.includes(KEYWORDS.TEMPORARY)) card.keywords.push(KEYWORDS.TEMPORARY)
  game.state.log.push('A vehicle was readied for a Flyby run')
  return { ok: true, game }
}

// SS: "Grant a friendly vehicle subscreen and airscreen keywords." Permanent —
// keywords live on the entry — and idempotent, as Flyby's grant is. The hull
// is on the board, so naming it in the public log leaks nothing.
function counterIntelligence(game: EngineGame, actor: Side, instanceId: string | undefined): ApplyResult {
  if (typeof instanceId !== 'string') return err(400, 'Counter Intelligence needs one of your vehicles')
  const found = findVehicle(game.state, instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  for (const keyword of [KEYWORDS.AIR_SCREEN, KEYWORDS.SUB_SCREEN]) {
    if (!found.entry.keywords.includes(keyword)) found.entry.keywords.push(keyword)
  }
  game.state.log.push(`${found.entry.name} now screens the air and the depths (Counter Intelligence)`)
  return { ok: true, game }
}

// TG: "Spawn a TEMPORARY Mirth swarm into each zone." SPAWNING IS NOT PLAYING
// (spec §7.4, Fear's precedent): no payment, no biome check, no zone cap.
// Mirth Swarm already prints TEMPORARY, so no keyword is passed — the swarms
// are culled at this player's END_TURN like any other Temporary hull.
//
// A catalog without the card is a data bug, not an empty pool: fail the
// action before any zone is touched rather than half-apply it.
function drones(game: EngineGame, actor: Side, ctx: EngineContext): ApplyResult {
  const swarm = catalogCard(ctx, 'Mirth Swarm')
  if (!swarm) return err(400, 'Drones cannot find a Mirth Swarm to launch')
  for (const zone of game.state.zones) spawnInto(game, ctx, actor, zone.id, swarm)
  game.state.log.push(
    `Drones: a Mirth Swarm launches into every zone for player ${actor.toUpperCase()}`,
  )
  return { ok: true, game }
}

// WF: "Choose a zone. The next time you start a fleet battle in that zone this
// turn, you may deploy after the defender. During that battle, all enemy
// [vehicles] are considered to have FRAGILE." Ambush's shape minus the
// distance and the compensation draw: a rest-of-turn zoneEffects rider,
// expiring at this player's own END_TURN, spent by battleDeclare's
// applyFlankingManeuver at the owner's own battle lock there. "Ships" is read
// as the whole enemy fleet (ruling recorded in spec §3.8): a literal reading
// would make the power do nothing in a beach or land zone.
function flankingManeuver(game: EngineGame, actor: Side, zoneId: number | undefined): ApplyResult {
  if (typeof zoneId !== 'number') return err(400, 'Flanking Maneuver needs a zone')
  const zone = zoneById(game.state, zoneId)
  if (!zone) return err(400, 'No such zone')
  game.state.zoneEffects.push({
    effect: FLANKING_MANEUVER_EFFECT, zoneId, side: actor, cardName: FLANKING_MANEUVER_NAME,
    setOnTurn: game.turnNumber, expiresOnTurn: game.turnNumber,
    data: { flanking: true },
  })
  game.state.log.push(
    `Player ${actor.toUpperCase()} plans a Flanking Maneuver in zone ${zoneId} — for the rest of the turn`,
  )
  return { ok: true, game }
}

// Exported for [GT] Monsoon's activated ability, which is a relocation with a
// different price and gate but identical mechanics.
export function moveEntry(game: EngineGame, actor: Side, instanceId: string, zoneId: number, stampMove: boolean) {
  const found = findVehicle(game.state, instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  const target = zoneById(game.state, zoneId)
  if (!target || target.id === found.zone.id) return err(400, 'Pick a different zone')
  if (!biomeAllows(found.entry.vehicleType, target.biome)) {
    return err(400, `${found.entry.name} cannot operate in ${target.biome}`)
  }
  // The move half of the zone-side cap — zoneCapFor's DERIVED cap (spec
  // §4.1: the tighter of the flat gameSettings.MAX_VEHICLES_PER_ZONE_SIDE and
  // whatever the enemy denies in this zone), not the flat constant read
  // directly. Without it a player could deploy into a spare zone and walk
  // hulls into a full one, which is the cap in name only.
  //
  // Reads the DESTINATION, and does so BEFORE the source removal below — so a
  // side sitting at the cap can still move hulls OUT, which a check written
  // against the source (or run after the splice) would have frozen in place.
  // moveEntry is the single chokepoint for MOVE_VEHICLE and [GT] Monsoon
  // alike, so both are covered by this one gate.
  const cap = zoneCapFor(game.state, actor, zoneId)
  if (target.cards[actor].length >= cap) {
    return err(400, `Zone ${zoneId} already holds your ${cap}-vehicle limit`)
  }
  found.zone.cards[actor] = found.zone.cards[actor].filter((c) => c.instanceId !== instanceId)
  const entry: ZoneCardEntry = { ...found.entry, movedOnTurn: stampMove ? game.turnNumber : found.entry.movedOnTurn }
  target.cards[actor].push(entry)
  game.state.log.push(`${found.entry.name} relocated to zone ${zoneId}`)
  return { ok: true as const, game }
}

registerHandler('MOVE_VEHICLE', (game, actor, action) => {
  if (action.type !== 'MOVE_VEHICLE') return err(400, 'Bad action')
  if (game.activePlayer !== (actor === 'a' ? game.playerA : game.playerB)) return err(409, 'Not your turn')
  const found = findVehicle(game.state, action.instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  if (!found.entry.keywords.includes(KEYWORDS.MOBILE)) return err(400, `${found.entry.name} is not Mobile`)
  if (found.entry.movedOnTurn === game.turnNumber) return err(409, `${found.entry.name} already moved this turn`)
  return moveEntry(game, actor, action.instanceId, action.zoneId, true)
})

registerHandler('USE_HERO_POWER', (game, actor, action, ctx) => {
  if (action.type !== 'USE_HERO_POWER') return err(400, 'Bad action')
  const res = game.state.resources[actor]
  if (game.state.usedHeroPowers[actor].includes(action.power)) {
    return err(400, 'That hero power was already used this game')
  }
  if (res.cp < 1) return err(400, 'Not enough CP')
  const requiredFaction = Object.hasOwn(FACTION_POWERS, action.power)
    ? FACTION_POWERS[action.power as keyof typeof FACTION_POWERS]
    : undefined
  if (requiredFaction && game.state.factions[actor] !== requiredFaction) {
    return err(403, 'That power belongs to another faction')
  }
  const isMyTurn = game.activePlayer === (actor === 'a' ? game.playerA : game.playerB)

  if (action.power === 'tacticalPositioning') {
    const battle = game.state.activeBattle
    if (!battle || game.state.pendingReport) return err(409, 'No battle to reposition')
    if (battle.distanceModifiedBy.includes(actor)) {
      return err(409, 'You already adjusted this battle')
    }
    if (typeof action.distanceDeltaM !== 'number' || !Number.isFinite(action.distanceDeltaM)) {
      return err(400, 'Distance shift must be a number')
    }
    const delta = action.distanceDeltaM
    if (delta === 0 || Math.abs(delta) > HERO_POWER_DISTANCE_MOD_M) {
      return err(400, `Distance shift must be within ±${HERO_POWER_DISTANCE_MOD_M}m`)
    }
    battle.distanceM = Math.min(SPAWN_DISTANCE_MAX_M, Math.max(SPAWN_DISTANCE_MIN_M, battle.distanceM + delta))
    battle.distanceModifiedBy.push(actor)
    game.state.log.push(`Spawn distance adjusted to ${battle.distanceM}m (Tactical Positioning)`)
  } else {
    if (!isMyTurn) return err(409, 'Not your turn')
    if (battleFrozen(game.state)) return err(409, 'Resolve the battle first')
    if (action.power === 'draw') {
      drawCard(game, actor, ctx)
      game.state.log.push('Hero Power Draw')
    } else if (action.power === 'salvage') {
      const index = game.state.destroyed[actor].findIndex(
        (c) => c.cardId === action.cardId && c.type === 'vehicle',
      )
      if (index < 0) return err(400, 'No such destroyed vehicle to salvage')
      const [card] = game.state.destroyed[actor].splice(index, 1)
      putInHand(game, actor, { ...card, instanceId: `hp-${card.cardId}-${game.turnNumber}-${actor}` })
      game.state.log.push(`${card.name} salvaged back to hand`)
    } else if (action.power === 'rapidRedeployment') {
      const moved = moveEntry(game, actor, action.instanceId ?? '', action.zoneId ?? -1, true)
      if (!moved.ok) return moved
    } else if (action.power === 'boardingParty') {
      const result = boardingParty(game, actor, action.instanceId, action.targetInstanceId)
      if (!result.ok) return result
    } else if (action.power === 'changeOrder') {
      const result = changeOrder(game, actor, action.instanceId)
      if (!result.ok) return result
    } else if (action.power === 'flyby') {
      const result = flyby(game, actor, action.instanceId)
      if (!result.ok) return result
    } else if (action.power === 'counterIntelligence') {
      const result = counterIntelligence(game, actor, action.instanceId)
      if (!result.ok) return result
    } else if (action.power === 'drones') {
      const result = drones(game, actor, ctx)
      if (!result.ok) return result
    } else if (action.power === 'flankingManeuver') {
      const result = flankingManeuver(game, actor, action.zoneId)
      if (!result.ok) return result
    } else {
      return err(400, 'Unknown hero power')
    }
  }
  res.cp -= 1
  game.state.usedHeroPowers[actor].push(action.power)
  return { ok: true, game }
})
