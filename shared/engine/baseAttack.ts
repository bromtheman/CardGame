import { BASE_DAMAGE_DIVISOR, KEYWORDS, VEHICLE_TYPES } from '../gameSettings.ts'
import type { ZoneCardEntry } from './engineTypes.ts'
import { checkVictory, err, otherSide, registerHandler, zoneById } from './gameEngine.ts'
import { effectiveMaterialCostOf } from './placement.ts'
import { dispatchBaseAttackVictory, dispatchZoneInterception } from './battleTriggers.ts'

// Which hulls in a zone actually strike its enemy base: not subs, not
// Inoffensive, not deployed this turn. The single definition of that roster —
// baseDamageFrom sums over it, and DP2's bombardment dispatch (spec §4.3, DP2
// departure 5) fires for exactly these and no other hull standing in the zone,
// because "inflicts damage to the enemy base" is what Plunderer's text asks.
export function baseStrikersIn(entries: ZoneCardEntry[], turnNumber: number): ZoneCardEntry[] {
  return entries.filter(
    (c) =>
      c.vehicleType !== VEHICLE_TYPES.SUB &&
      !c.keywords.includes(KEYWORDS.INOFFENSIVE) &&
      c.playedOnTurn < turnNumber,
  )
}

export function baseDamageFrom(entries: ZoneCardEntry[], turnNumber: number): number {
  return baseStrikersIn(entries, turnNumber)
    .reduce((sum, c) => sum + Math.floor(effectiveMaterialCostOf(c) / BASE_DAMAGE_DIVISOR), 0)
}

registerHandler('ATTACK_ENEMY_BASE', (game, actor, action, ctx) => {
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
  const strikers = baseStrikersIn(zone.cards[actor] as ZoneCardEntry[], game.turnNumber)
  const damage = baseDamageFrom(zone.cards[actor] as ZoneCardEntry[], game.turnNumber)
  if (damage <= 0) return err(400, 'No vehicles able to strike (subs, inoffensive, and fresh deployments cannot)')

  // A zone-effect rider on the DEFENDER's side may take the attack instead
  // (spec §7.3, DWG Waters clause 3). Dispatched after every refusal above, so
  // an illegal bombardment intercepts nothing, and before the damage below,
  // because the whole point is that no damage lands. The rider declares the
  // battle itself and passes activatesZone, so the attacker's one activation
  // is spent on fighting rather than bombarding.
  dispatchZoneInterception(game, ctx, zone.id, actor)
  if (game.state.activeBattle) return { ok: true, game }

  zone.lastActivatedTurn = game.turnNumber
  zone.baseHp[enemy] = Math.max(0, zone.baseHp[enemy] - damage)
  game.state.log.push(`Zone ${zone.id}: base bombardment for ${damage} (${zone.baseHp[enemy]} HP remains)`)
  if (zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${zone.id} has fallen`)
  checkVictory(game)
  // Only on the success path, so a refused bombardment (a Blocker, an
  // already-spent zone, nothing able to strike) fires nothing. Placed after
  // checkVictory so the trigger sees the final status — NOT, as an earlier
  // comment claimed, because that prevents it changing an ended game: nothing
  // stops plundererRaid drawing after status flips to complete, and nothing
  // needs to.
  dispatchBaseAttackVictory(game, ctx, zone.id, actor, strikers)
  return { ok: true, game }
})
