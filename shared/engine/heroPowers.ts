import {
  HERO_POWER_DISTANCE_MOD_M, KEYWORDS, SPAWN_DISTANCE_MAX_M, SPAWN_DISTANCE_MIN_M,
} from '../gameSettings.ts'
import type { EngineGame, Side, ZoneCardEntry } from './engineTypes.ts'
import { battleFrozen, drawCard, err, findVehicle, registerHandler, zoneById } from './gameEngine.ts'
import { biomeAllows } from './placement.ts'

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
    } else {
      return err(400, 'Unknown hero power')
    }
  }
  res.cp -= 1
  game.state.usedHeroPowers[actor].push(action.power)
  return { ok: true, game }
})
