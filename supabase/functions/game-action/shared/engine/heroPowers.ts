import {
  CHANGE_ORDER_DELAY_TURNS, HERO_POWER_DISTANCE_MOD_M, KEYWORDS,
  SPAWN_DISTANCE_MAX_M, SPAWN_DISTANCE_MIN_M,
} from '../gameSettings.ts'
import type { ApplyResult, EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import {
  battleFrozen, drawCard, err, findVehicle, otherSide, registerHandler, zoneById,
} from './gameEngine.ts'
import { biomeAllows, effectiveMaterialCostOf } from './placement.ts'

// power → faction that alone may use it. Powers absent from this map (the
// four universal ones) are open to any faction.
const FACTION_POWERS: Record<'boardingParty' | 'changeOrder' | 'flyby', string> = {
  boardingParty: 'DWG', changeOrder: 'OW', flyby: 'LH',
}

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
  const flippedMine: ZoneCardEntry = { ...mine.entry, playedOnTurn: game.turnNumber, movedOnTurn: null }
  const flippedTheirs: ZoneCardEntry = { ...theirs.entry, playedOnTurn: game.turnNumber, movedOnTurn: null }
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
  const { instanceId: _instanceId, ...snapshot } = card
  game.state.destroyed[actor].push(snapshot)
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

function moveEntry(game: EngineGame, actor: Side, instanceId: string, zoneId: number, stampMove: boolean) {
  const found = findVehicle(game.state, instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  const target = zoneById(game.state, zoneId)
  if (!target || target.id === found.zone.id) return err(400, 'Pick a different zone')
  if (!biomeAllows(found.entry.vehicleType, target.biome)) {
    return err(400, `${found.entry.name} cannot operate in ${target.biome}`)
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

registerHandler('USE_HERO_POWER', (game, actor, action) => {
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
      drawCard(game, actor)
      game.state.log.push('Hero Power Draw')
    } else if (action.power === 'salvage') {
      const index = game.state.destroyed[actor].findIndex(
        (c) => c.cardId === action.cardId && c.type === 'vehicle',
      )
      if (index < 0) return err(400, 'No such destroyed vehicle to salvage')
      const [card] = game.state.destroyed[actor].splice(index, 1)
      game.privates[actor].hand.push({
        ...card, instanceId: `hp-${card.cardId}-${game.turnNumber}-${actor}`,
      })
      game.state.counts[actor].hand = game.privates[actor].hand.length
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
    } else {
      return err(400, 'Unknown hero power')
    }
  }
  res.cp -= 1
  game.state.usedHeroPowers[actor].push(action.power)
  return { ok: true, game }
})
