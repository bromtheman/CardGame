import { err, findVehicle, registerHandler } from './gameEngine.ts'
import { effectFor, effectName } from '../effects/registry.ts'

// The price of an activated ability is plain card data, in the same class as
// additionalSpawns: a number in meta, with no registry entry (spec §4.3).
//
// There are TWO prices since wave 6, and they are independent. A card may
// carry either or both, and needs at least one — a card with `onActivate` and
// no price has no activated ability at all, and no board button either
// (BoardZone.tsx gates on the same pair).
//
// Both parsers return null for an absent key AND for a malformed one; the
// handler tells those apart by looking at the raw key, so a mistyped price is
// a refusal rather than a free activation.
export function activateCpCostOf(card: { meta: Record<string, unknown> }): number | null {
  return parsePrice(card.meta.activateCpCost)
}

// SS Victoria: "each turn you may spend 200k resources to spawn another
// victoria into this zone" — an activated ability paid in materials, not CP.
export function activateMaterialCostOf(card: { meta: Record<string, unknown> }): number | null {
  return parsePrice(card.meta.activateMaterialCost)
}

function parsePrice(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.floor(raw)
}

const priceKeyPresent = (card: { meta: Record<string, unknown> }, key: string): boolean =>
  card.meta[key] !== undefined && card.meta[key] !== null

// DP1. Activating is not playing: the hull is already on the board, so there
// is no placement legality, no spendCard, and no purchase-price machinery —
// an activation price is charged FLAT (spec §7.3, wave 6). Half-Cost and
// costModifier are play-time mechanics, so a Half-Cost hull does not activate
// at half price. The turn is stamped BEFORE the effect fires, so an ability
// that suspends (wave 3) cannot be re-entered through a second activation.
registerHandler('ACTIVATE_VEHICLE', (game, actor, action, ctx) => {
  if (action.type !== 'ACTIVATE_VEHICLE') return err(400, 'Bad action')
  const found = findVehicle(game.state, action.instanceId)
  if (!found || found.side !== actor) return err(400, 'That is not your vehicle')
  const entry = found.entry

  const cpCost = activateCpCostOf(entry)
  const materialCost = activateMaterialCostOf(entry)
  const name = effectName(entry, 'onActivate')
  if (name === null || (cpCost === null && materialCost === null)) {
    return err(400, `${entry.name} has no activated ability`)
  }
  // A price key that is PRESENT but not a usable number is a data bug, and
  // must not read as "free". A mistyped data value is otherwise inert and
  // invisible — the blind spot docs/claude/card-effects.md warns about.
  if (
    (priceKeyPresent(entry, 'activateCpCost') && cpCost === null) ||
    (priceKeyPresent(entry, 'activateMaterialCost') && materialCost === null)
  ) {
    return err(400, `${entry.name}'s activation price is not a valid number`)
  }
  const fn = effectFor(name)
  if (!fn) return err(400, `${entry.name}'s activated ability is not implemented yet`)
  if (entry.activatedOnTurn === game.turnNumber) {
    return err(409, `${entry.name} was already activated this turn`)
  }
  // Both affordability checks run before either charge: a card carrying both
  // prices pays both or neither.
  if (cpCost !== null && game.state.resources[actor].cp < cpCost) return err(400, 'Not enough CP')
  if (materialCost !== null && game.state.resources[actor].materials < materialCost) {
    return err(400, 'Not enough materials')
  }

  if (cpCost !== null) game.state.resources[actor].cp -= cpCost
  if (materialCost !== null) game.state.resources[actor].materials -= materialCost
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
