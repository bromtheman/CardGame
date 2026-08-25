import { KEYWORDS, SPAWN_DISTANCE_DEFAULT_M } from '../gameSettings.ts'
import type { Side } from './engineTypes.ts'
import type { EngineGame } from './engineTypes.ts'
import { err, otherSide, registerHandler, zoneById } from './gameEngine.ts'

function lockBattle(
  game: EngineGame, zoneId: number, aggressor: Side, attackerIds: string[], defenderIds: string[],
): void {
  game.state.activeBattle = {
    zoneId, aggressor, attackerIds, defenderIds,
    distanceM: SPAWN_DISTANCE_DEFAULT_M, distanceModifiedBy: [],
  }
  zoneById(game.state, zoneId)!.lastActivatedTurn = game.turnNumber
  game.state.log.push(
    `Fleet battle declared in zone ${zoneId} — ${attackerIds.length} vs ${defenderIds.length}. Fight it in From The Depths, then report results.`,
  )
}

registerHandler('ATTACK_ENEMY_FLEET', (game, actor, action) => {
  if (action.type !== 'ATTACK_ENEMY_FLEET') return err(400, 'Bad action')
  const zone = zoneById(game.state, action.zoneId)
  if (!zone) return err(400, 'No such zone')
  if (zone.lastActivatedTurn === game.turnNumber) return err(409, 'That zone was already activated this turn')
  const enemy = otherSide(actor)
  const mine = zone.cards[actor]
  const theirs = zone.cards[enemy]
  if (action.attackerIds.length === 0 || action.targetIds.length === 0) {
    return err(400, 'Pick at least one attacker and one target')
  }
  for (const id of action.attackerIds) {
    const card = mine.find((c) => c.instanceId === id)
    if (!card) return err(400, 'Attacker selection includes a vehicle that is not yours in that zone')
    if (card.keywords.includes(KEYWORDS.INOFFENSIVE)) {
      return err(400, `${card.name} is Inoffensive and cannot attack`)
    }
  }
  const stealthyIds: string[] = []
  for (const id of action.targetIds) {
    const card = theirs.find((c) => c.instanceId === id)
    if (!card) return err(400, 'Target selection includes a vehicle that is not in that zone')
    if (card.keywords.includes(KEYWORDS.STEALTHY)) stealthyIds.push(id)
  }
  if (stealthyIds.length > 0) {
    game.state.awaitingResponse = {
      zoneId: action.zoneId, aggressor: actor,
      attackerIds: action.attackerIds, targetIds: action.targetIds, stealthyIds,
    }
    game.state.log.push(`Fleet attack declared in zone ${action.zoneId} — stealthy defenders may withdraw`)
    return { ok: true, game }
  }
  lockBattle(game, action.zoneId, actor, action.attackerIds, action.targetIds)
  return { ok: true, game }
})

registerHandler('RESPOND_TO_ATTACK', (game, actor, action) => {
  if (action.type !== 'RESPOND_TO_ATTACK') return err(400, 'Bad action')
  const pending = game.state.awaitingResponse
  if (!pending) return err(409, 'No attack awaits a response')
  if (actor === pending.aggressor) return err(403, 'Only the defender responds')
  for (const id of action.optOutIds) {
    if (!pending.stealthyIds.includes(id)) return err(400, 'Only stealthy vehicles may withdraw')
  }
  const remaining = pending.targetIds.filter((id) => !action.optOutIds.includes(id))
  game.state.awaitingResponse = null
  if (remaining.length === 0) {
    game.state.log.push('All defenders slipped away — the attack is called off')
    return { ok: true, game }
  }
  lockBattle(game, pending.zoneId, pending.aggressor, pending.attackerIds, remaining)
  return { ok: true, game }
})
