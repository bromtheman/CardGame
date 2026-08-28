import { err, findVehicle, registerHandler } from './gameEngine.ts'
import { effectFor, effectName } from '../effects/registry.ts'

// The CP price of an activated ability is plain card data, in the same class
// as additionalSpawns: a number in meta, with no registry entry (spec §4.3).
// A card with no activateCpCost has no activated ability at all.
export function activateCpCostOf(card: { meta: Record<string, unknown> }): number | null {
  const raw = card.meta.activateCpCost
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.floor(raw)
}

// DP1. Activating is not playing: the hull is already on the board, so there
// is no placement legality, no material cost, and no spendCard. The turn is
// stamped BEFORE the effect fires, so an ability that suspends (wave 3)
// cannot be re-entered through a second activation.
registerHandler('ACTIVATE_VEHICLE', (game, actor, action, ctx) => {
  if (action.type !== 'ACTIVATE_VEHICLE') return err(400, 'Bad action')
  const found = findVehicle(game.state, action.instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  const entry = found.entry

  const cost = activateCpCostOf(entry)
  const name = effectName(entry, 'onActivate')
  if (cost === null || name === null) return err(400, `${entry.name} has no activated ability`)
  const fn = effectFor(name)
  if (!fn) return err(400, `${entry.name}'s activated ability is not implemented yet`)
  if (entry.activatedOnTurn === game.turnNumber) {
    return err(409, `${entry.name} was already activated this turn`)
  }
  if (game.state.resources[actor].cp < cost) return err(400, 'Not enough CP')

  game.state.resources[actor].cp -= cost
  entry.activatedOnTurn = game.turnNumber
  const resolved = fn({
    game,
    actor,
    card: entry,
    ctx,
    targetZoneId: action.zoneId,
    targetInstanceId: action.targetInstanceId,
  })
  if (!resolved) return err(400, `${entry.name}'s ability could not resolve — check its target`)

  game.state.log.push(`${entry.name} activated`)
  return { ok: true, game }
})
