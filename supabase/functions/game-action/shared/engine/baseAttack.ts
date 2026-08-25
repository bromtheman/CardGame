import { BASE_DAMAGE_DIVISOR, KEYWORDS, VEHICLE_TYPES } from '../gameSettings.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
import { checkVictory, err, otherSide, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'

export function baseDamageFrom(entries: ZoneCardEntry[], turnNumber: number): number {
  return entries
    .filter(
      (c) =>
        c.vehicleType !== VEHICLE_TYPES.SUB &&
        !c.keywords.includes(KEYWORDS.INOFFENSIVE) &&
        c.playedOnTurn < turnNumber,
    )
    .reduce((sum, c) => sum + Math.floor(effectiveMaterialCostOf(c) / BASE_DAMAGE_DIVISOR), 0)
}

registerHandler('ATTACK_ENEMY_BASE', (game, actor, action) => {
  if (action.type !== 'ATTACK_ENEMY_BASE') return err(400, 'Bad action')
  const zone = zoneById(game.state, action.zoneId)
  if (!zone) return err(400, 'No such zone')
  const enemy = otherSide(actor)
  if (zone.cards[actor].length === 0) return err(400, 'You have no vehicles in that zone')
  if (zone.lastActivatedTurn === game.turnNumber) return err(409, 'That zone was already activated this turn')
  if (zone.baseHp[enemy] <= 0) return err(400, 'That base is already destroyed')
  if (zone.cards[enemy].some((c) => c.keywords.includes(KEYWORDS.BLOCKER))) {
    return err(400, 'An enemy Blocker protects that base')
  }
  const damage = baseDamageFrom(zone.cards[actor] as ZoneCardEntry[], game.turnNumber)
  if (damage <= 0) return err(400, 'No vehicles able to strike (subs, inoffensive, and fresh deployments cannot)')
  zone.lastActivatedTurn = game.turnNumber
  zone.baseHp[enemy] = Math.max(0, zone.baseHp[enemy] - damage)
  game.state.log.push(`Zone ${zone.id}: base bombardment for ${damage} (${zone.baseHp[enemy]} HP remains)`)
  if (zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${zone.id} has fallen`)
  checkVictory(game)
  return { ok: true, game }
})
