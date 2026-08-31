import { KEYWORDS, SPAWN_DISTANCE_DEFAULT_M, VEHICLE_TYPES } from '../gameSettings.ts'
import type { BattleContinuation, EngineContext, Side, ZoneCardEntry } from './engineTypes.ts'
import type { EngineGame } from './engineTypes.ts'
import { err, findVehicle, otherSide, registerHandler, zoneById } from './gameEngine.ts'
import { dispatchBattleLock } from './battleTriggers.ts'

// The one condition meta.defensiveOmission expresses today (spec §4.8). A
// string rather than a boolean so a second condition is expressible without a
// second meta key; Buzzsaw and Veles print identical text and share this one.
export const OMISSION_UNLESS_SHIP_OR_TANK = 'unlessShipOrTank'

// The only place the activeBattle object literal is constructed (spec §4.3,
// departure 1) — so the next field added to it is one edit here rather than
// three call sites. summons/continuation default to "none": only a forced
// battle (declareForcedBattle) ever populates them.
function setBattle(game: EngineGame, spec: {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  summons?: ZoneCardEntry[]
  continuation?: BattleContinuation | null
}): void {
  game.state.activeBattle = {
    zoneId: spec.zoneId, aggressor: spec.aggressor,
    attackerIds: spec.attackerIds, defenderIds: spec.defenderIds,
    distanceM: SPAWN_DISTANCE_DEFAULT_M, distanceModifiedBy: [],
    summons: spec.summons ?? [],
    continuation: spec.continuation ?? null,
  }
}

// setBattle plus the zone-activation stamp plus the fleet log line — used
// only by ATTACK_ENEMY_FLEET and RESPOND_TO_ATTACK, where declaring the
// battle IS the zone's one activation for the turn. Kept byte-identical in
// behaviour across the setBattle/lockBattle/declareForcedBattle split.
function lockBattle(
  game: EngineGame, ctx: EngineContext,
  zoneId: number, aggressor: Side, attackerIds: string[], defenderIds: string[],
): void {
  setBattle(game, { zoneId, aggressor, attackerIds, defenderIds })
  zoneById(game.state, zoneId)!.lastActivatedTurn = game.turnNumber
  game.state.log.push(
    `Fleet battle declared in zone ${zoneId} — ${attackerIds.length} vs ${defenderIds.length}. Fight it in From The Depths, then report results.`,
  )
  // DP2 at lock (spec §4.3). After the log line, so the order a player reads
  // is declare-then-trigger; `forced: false` because this IS the ordinary
  // fleet attack, which is what Terawatt's bystander rule excludes.
  dispatchBattleLock(game, ctx, false)
}

// The only function that appends to a battle already in progress. Every other
// path builds ActiveBattle whole, at construction (setBattle) — but a DP2 lock
// trigger runs when the battle already exists, so The Onyx Throne's Parapet
// and Terawatt's join need a way in that declareForcedBattle cannot give them:
// it refuses outright while state.activeBattle is non-null, which at lock it
// always is.
//
// `entry` present  → a freshly minted hull: pushed onto summons AND onto the
//                    joining side's id list, so it is a battle summon in the
//                    ordinary sense (spec §4.4) and evaporates on approval.
// `entry` absent   → an id already on the board: only the id list is touched.
//
// Membership decides a summon's side (decision 18), so pushing onto the right
// list is the whole of "which side did it join".
export function joinBattle(
  game: EngineGame, side: Side, instanceId: string, entry?: ZoneCardEntry,
): boolean {
  const battle = game.state.activeBattle
  if (!battle) return false
  if (battle.attackerIds.includes(instanceId) || battle.defenderIds.includes(instanceId)) return false
  if (!entry) {
    const zone = zoneById(game.state, battle.zoneId)
    if (!zone || !zone.cards[side].some((c) => c.instanceId === instanceId)) return false
  } else {
    battle.summons.push(entry)
  }
  if (side === battle.aggressor) battle.attackerIds.push(instanceId)
  else battle.defenderIds.push(instanceId)
  return true
}

// DP3 (spec §4.3): a card-forced battle. Two rulings distinguish it from an
// ordinary fleet attack, and both are load-bearing (departure 1) — reusing
// lockBattle unchanged would violate both:
//   - It is NOT a zone activation: lastActivatedTurn is left untouched unless
//     the caller explicitly passes activatesZone (Eclipse alone does, per its
//     own card text).
//   - It skips the Stealthy opt-out entirely — the card *forces* the fight,
//     so there is no awaitingResponse window; the battle locks immediately.
// Sets no alert card (spec §4.3, departure 2): the BattleOverlay this raises
// is already louder and already public, and the alert slot is single/shared
// with the opponent's own alerts.
//
// Returns false — so the calling effect 400s and applyAction discards the
// clone — without mutating `game` at all, on: no such zone, a battle already
// active, an empty attacker or defender list, or an id that is neither an
// on-field entry on its own side nor one of the listed summons. Membership in
// `summons` (not a side field) decides which side a summon belongs to, so the
// same check serves attacker- and defender-side summons alike (decision 18).
export function declareForcedBattle(game: EngineGame, ctx: EngineContext, spec: {
  zoneId: number
  aggressor: Side
  attackerIds: string[]
  defenderIds: string[]
  summons?: ZoneCardEntry[]
  continuation?: BattleContinuation | null
  cause: string            // card name, for the log line
  activatesZone?: boolean  // stamps lastActivatedTurn; Eclipse alone passes true
  // Wave 7 — TG Duel: "target a friendly and enemy vehicle. They can be in
  // different zones." OPT-IN, mirroring activatesZone above, so every existing
  // caller keeps the same-zone guard it has always had rather than having it
  // quietly widened underneath. `zoneId` remains the battle's home zone (the
  // aggressor's own hull's); the away hull is resolved by id.
  crossZone?: boolean
}): boolean {
  const zone = zoneById(game.state, spec.zoneId)
  if (!zone) return false
  if (game.state.activeBattle) return false
  if (spec.attackerIds.length === 0 || spec.defenderIds.length === 0) return false
  const defenderSide = otherSide(spec.aggressor)
  const summonIds = new Set((spec.summons ?? []).map((s) => s.instanceId))
  // Find-by-ID rather than skip-the-check: a cross-zone declaration still
  // refuses an unknown id and still refuses a hull listed on the wrong side.
  const onField = (side: Side, id: string) => (
    spec.crossZone
      ? findVehicle(game.state, id)?.side === side
      : zone.cards[side].some((c) => c.instanceId === id)
  )
  for (const id of spec.attackerIds) {
    if (!onField(spec.aggressor, id) && !summonIds.has(id)) return false
  }
  for (const id of spec.defenderIds) {
    if (!onField(defenderSide, id) && !summonIds.has(id)) return false
  }
  setBattle(game, spec)
  if (spec.activatesZone) zone.lastActivatedTurn = game.turnNumber
  // Never "Fleet battle" — these are usually 1v1, and that phrase is reserved
  // for ATTACK_ENEMY_FLEET's own line. The tail sentence is kept verbatim:
  // players rely on it to know the overlay wants a From The Depths result.
  game.state.log.push(
    `${spec.cause} forces a battle in zone ${spec.zoneId} — ${spec.attackerIds.length} vs ${spec.defenderIds.length}. Fight it in From The Depths, then report results.`,
  )
  // DP2 at lock, with forced: true — which is what admits the bystander pass
  // (Terawatt, spec §4.3 DP2 departure 2). Fires only on the success path, so
  // a refused declaration triggers nothing. A trigger here MAY leave
  // state.pendingEffect set alongside the state.activeBattle just built
  // (departure 3, decision 19); that is deliberate and safe — see
  // gameEngine.ts's applyAction, and shared/engine/battleFreeze.test.ts.
  dispatchBattleLock(game, ctx, true)
  return true
}

registerHandler('ATTACK_ENEMY_FLEET', (game, actor, action, ctx) => {
  if (action.type !== 'ATTACK_ENEMY_FLEET') return err(400, 'Bad action')
  if (!Array.isArray(action.attackerIds) || !Array.isArray(action.targetIds)) {
    return err(400, 'attackerIds and targetIds must be arrays')
  }
  if (
    new Set(action.attackerIds).size !== action.attackerIds.length ||
    new Set(action.targetIds).size !== action.targetIds.length
  ) {
    return err(400, 'Selections contain duplicates')
  }
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
  // Spec §4.8: the attacking FORCE is the committed selection, not everything
  // the aggressor owns in the zone — a hull sitting the battle out is not
  // attacking. Read off the same ids already validated above.
  const forceHasShipOrTank = action.attackerIds.some((id) => {
    const card = mine.find((c) => c.instanceId === id)
    return card?.vehicleType === VEHICLE_TYPES.SHIP || card?.vehicleType === VEHICLE_TYPES.TANK
  })
  const stealthyIds: string[] = []
  const omissibleIds: string[] = []
  for (const id of action.targetIds) {
    const card = theirs.find((c) => c.instanceId === id)
    if (!card) return err(400, 'Target selection includes a vehicle that is not in that zone')
    if (card.keywords.includes(KEYWORDS.STEALTHY)) stealthyIds.push(id)
    // Plain card data, not a registry name (spec §4.8) — an effect returns a
    // boolean meaning "resolved" and may mutate, so one cannot serve as a pure
    // eligibility predicate.
    if (card.meta.defensiveOmission === OMISSION_UNLESS_SHIP_OR_TANK && !forceHasShipOrTank) {
      omissibleIds.push(id)
    }
  }
  // The window now opens on EITHER list. Before wave 4 only Stealthy could
  // raise it, and an attack with no stealthy target locked immediately.
  if (stealthyIds.length > 0 || omissibleIds.length > 0) {
    game.state.awaitingResponse = {
      zoneId: action.zoneId, aggressor: actor,
      attackerIds: action.attackerIds, targetIds: action.targetIds, stealthyIds, omissibleIds,
    }
    game.state.log.push(`Fleet attack declared in zone ${action.zoneId} — some defenders may withdraw`)
    return { ok: true, game }
  }
  lockBattle(game, ctx, action.zoneId, actor, action.attackerIds, action.targetIds)
  return { ok: true, game }
})

registerHandler('RESPOND_TO_ATTACK', (game, actor, action, ctx) => {
  if (action.type !== 'RESPOND_TO_ATTACK') return err(400, 'Bad action')
  if (!Array.isArray(action.optOutIds)) return err(400, 'optOutIds must be an array')
  const pending = game.state.awaitingResponse
  if (!pending) return err(409, 'No attack awaits a response')
  if (actor === pending.aggressor) return err(403, 'Only the defender responds')
  // Either list is a valid source of an opt-out (spec §4.8): Stealthy's is
  // unconditional, omissibleIds was computed against this attack's own
  // attacking selection when the window opened.
  for (const id of action.optOutIds) {
    if (!pending.stealthyIds.includes(id) && !(pending.omissibleIds ?? []).includes(id)) {
      return err(400, 'Only stealthy or omissible vehicles may withdraw')
    }
  }
  const remaining = pending.targetIds.filter((id) => !action.optOutIds.includes(id))
  game.state.awaitingResponse = null
  if (remaining.length === 0) {
    game.state.log.push('All defenders slipped away — the attack is called off')
    return { ok: true, game }
  }
  lockBattle(game, ctx, pending.zoneId, pending.aggressor, pending.attackerIds, remaining)
  return { ok: true, game }
})
