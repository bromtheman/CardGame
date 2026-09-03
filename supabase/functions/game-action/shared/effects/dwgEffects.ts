import {
  BASE_DAMAGE_DIVISOR, ONGOING_ATTRITION_DAMAGE_PER_VEHICLE,
  DOUBLE_UP_MAX_COST, DWG_WATERS_GUEST_MAX_COST, FLYING_SQUIRREL_ATTACK_COUNT,
  HERO_POWER_LABELS, KEYWORDS, RESERVES_CARD_COUNT, VEHICLE_TYPES,
} from '../gameSettings.ts'
import type { EngineContext, EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import type { SnapshotCard } from '../engine/gameInit.ts'
import {
  checkVictory, copyMeta, discardCard, discardSnapshotOf, drawCard, findVehicle, otherSide, zoneById,
} from '../engine/gameEngine.ts'
import { effectiveMaterialCostOf } from '../engine/placement.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import { baseDamageFrom, baseStrikersIn } from '../engine/baseAttack.ts'
import { fireDeathEffect } from '../engine/battleTriggers.ts'
import { choice, grant, mintHull, poolEligible, summonHulls, takeFromEnemyDeck } from './primitives.ts'
import { registerCostModifier, registerEffect } from './registry.ts'
import type { EffectPayload } from './registry.ts'

// draw a card and gain 1 CP (Crossbones)
const drawPlusCp = ({ game, actor, ctx }: EffectPayload): boolean => {
  drawCard(game, actor, ctx)
  game.state.resources[actor].cp += 1
  return true
}
registerEffect('crossbonesOnPlay', drawPlusCp)

// "When this vehicle is played, draw a vehicle card from the enemy deck."
// The ported implementation aliased this to Crossbones' own-deck draw plus
// 1 CP; card text is authoritative (spec 2 §6), so that ruling is superseded.
//
// The 2026-09-02 balance pass removed the trailing "reduce its cost by 50k"
// clause and raised Marauder 40k -> 55k, which is why nothing stamps a
// costDelta here any more and MARAUDER_DISCOUNT is gone (2026-09-02 spec §6.1,
// R-8). The whole card is now the capture: takeFromEnemyDeck resyncs both
// sides' counts and never names the card it moves into a hidden hand.
registerEffect('marauderOnPlay', ({ game, actor, ctx }) =>
  takeFromEnemyDeck(game, actor, ctx, (c) => c.type === 'vehicle'))

registerEffect('ransackOnPlay', grant({ draw: 1, cp: 1 }))
registerEffect('paddlegunEffect', grant({ draw: 1, from: 'enemy' }))

// Plunderer clause 2: "When this vehicle survives a victorious fleet battle or
// inflicts damage to the enemy base, draw one card from the enemy deck."
//
// One clause, two occasions, one implementation (spec §4.3, DP2 departure 5).
// `onBattleVictory` at resolve only reaches a participant on the winning side,
// and `survived` is per-participant; ATTACK_ENEMY_BASE dispatches the same key
// with both set true, for exactly the hulls that dealt damage (baseStrikersIn
// — a sub or an Inoffensive hull did not inflict anything). So `survived &&
// won` is the whole condition, and it reads true on both occasions.
//
// takeFromEnemyDeck resyncs both sides' counts and never names the card: it is
// entering a hidden hand.
registerEffect('plundererRaid', ({ game, actor, ctx, battle }) => {
  if (!battle || !battle.survived || !battle.won) return true
  return takeFromEnemyDeck(game, actor, ctx)
})

// cost -20k per friendly DWG vehicle on the field (Plunderer)
registerCostModifier('plundererCostModifier', (state, side) => {
  let count = 0
  for (const zone of state.zones) {
    count += zone.cards[side].filter((c) => c.type === 'vehicle' && c.faction === 'DWG').length
  }
  return count * -20_000
})

// shuffle a 0-cost copy into its owner's deck (Loggerhead, on death)
registerEffect('loggerheadOnDeath', ({ game, actor, card, ctx }) => {
  const deck = game.privates[actor].deck
  // card arrives as a ZoneCardEntry at death — strip the zone stamps so the
  // deck copy is a clean CardInstance
  const { playedOnTurn: _p, movedOnTurn: _m, ...snapshot } = card as ZoneCardEntry
  deck.push({ ...snapshot, instanceId: ctx.newId(), materialCost: 0, meta: copyMeta(snapshot.meta) })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  game.state.counts[actor].deck = deck.length
  game.state.log.push(`${card.name} leaves a free copy in the deck`)
  return true
})

// add RESERVES_CARD_COUNT distinct random built-in DWG vehicles to hand
// (Reserves — old BE shuffles the pool and shifts, so picks never repeat)
registerEffect('reservesEffect', ({ game, actor, ctx }) => {
  // Mints straight from the catalog rather than through drawFromPool, so the
  // pool exclusion (spec §7.4) does not come for free by itself — it uses the
  // shared poolEligible predicate rather than drawFromPool's own filter.
  // Without it this pool matches Flying Squirrel.
  const pool = ctx.catalog.filter((c) =>
    c.isBuiltIn && c.faction === 'DWG' && c.type === 'vehicle' && poolEligible(c))
  if (pool.length === 0) return false
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  for (const pick of pool.slice(0, RESERVES_CARD_COUNT)) {
    game.privates[actor].hand.push({ ...pick, instanceId: ctx.newId() })
  }
  game.state.counts[actor].hand = game.privates[actor].hand.length
  return true
}, { needsCatalog: true })

// spawn a Scrappy, non-Temporary Buccaneer into the target zone (Spawn Buccaneer)
registerEffect('spawnBuccaneerEffect', ({ game, actor, ctx, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  const buccaneer = ctx.catalog.find((c) => c.isBuiltIn && c.name === 'Buccaneer')
  if (!zone || !buccaneer) return false
  const entry: ZoneCardEntry = {
    ...buccaneer, instanceId: ctx.newId(), keywords: [KEYWORDS.SCRAPPY],
    playedOnTurn: game.turnNumber, movedOnTurn: null, activatedOnTurn: null,
  }
  zone.cards[actor].push(entry)
  game.state.log.push(`A Buccaneer joins zone ${zone.id} (Scrappy)`)
  return true
}, { needsCatalog: true })

// Target DWG SHIP card in hand spawns an extra copy when played (Double Up).
// The 2026-08-30 balance pass narrowed "DWG vehicle" to "DWG ship": airships,
// planes, tanks and subs are no longer legal targets.
registerEffect('doubleUpEffect', ({ game, actor, card, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string' || targetInstanceId === card.instanceId) return false
  const target = game.privates[actor].hand.find((c) => c.instanceId === targetInstanceId)
  if (!target || target.type !== 'vehicle' || target.faction !== 'DWG') return false
  if (target.vehicleType !== VEHICLE_TYPES.SHIP) return false
  if (effectiveMaterialCostOf(target) > DOUBLE_UP_MAX_COST) return false
  const current = typeof target.meta.additionalSpawns === 'number' ? target.meta.additionalSpawns : 0
  target.meta = { ...target.meta, additionalSpawns: current + 1 }
  return true
})

const ONGOING_ATTRITION = 'ongoingAttritionEffect'

// "Choose a zone. For the rest of the turn, if that zone is activated, and you
// are attacking with more vehicles than your opponent, deal 40k damage to the
// enemy base in that zone for each vehicle you have in the zone more than your
// opponent. If this card leaves play without dealing damage, draw a card."
//
// DP5's zone half (spec §4.3, "DP5 as wave 5 built it"). One registry name,
// two occasions: the claim, and the strike — which fires on BOTH kinds of
// activation, because the card's trigger is "if that zone is activated" and
// `ATTACK_ENEMY_BASE` is one (spec §4.3, DP2 departure 9).
//
// The count is ZONE POPULATION on both halves of the sentence (spec §7.3):
// the damage clause names the zone explicitly, and a bombardment has no
// committed selection to read, so condition and formula collapse to
// `surplus > 0`.
//
// { needsCatalog: true } for the reason Ambush carries it: the rider dispatch
// mints its payload card from ctx.catalog by name.
function ongoingAttritionClaim({ game, actor, card, targetZoneId }: EffectPayload): boolean {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  if (!zone) return false
  const held = game.state.zoneEffects.some(
    (e) => e.effect === ONGOING_ATTRITION && e.zoneId === targetZoneId && e.side === actor,
  )
  if (held) return false
  game.state.zoneEffects.push({
    effect: ONGOING_ATTRITION, zoneId: targetZoneId, side: actor, cardName: card.name,
    setOnTurn: game.turnNumber, expiresOnTurn: game.turnNumber,
    data: { drawOnExpiry: true },
  })
  game.state.log.push(
    `Player ${actor.toUpperCase()} sets up ongoing attrition in zone ${targetZoneId} — for the rest of the turn`,
  )
  return true
}

function ongoingAttritionStrike(payload: EffectPayload): boolean {
  const { game, actor, card, battle } = payload
  if (!battle || battle.isDefender) return true
  if (battle.phase !== 'lock' && battle.phase !== 'baseAttack') return true
  // "IF THAT ZONE IS ACTIVATED" — and §4.3 rules that a forced battle is not a
  // zone activation: it neither consumes nor is blocked by lastActivatedTurn.
  // So a card-forced fight in the claimed zone does not trigger this, even
  // though the same fight WOULD trigger Ambush — whose text keys off fighting
  // a battle there, not off activating the zone. The two cards read
  // differently because they are written differently.
  if (battle.forced) return true
  const zone = zoneById(game.state, battle.zoneId)
  if (!zone) return true
  const enemy = otherSide(actor)
  const surplus = zone.cards[actor].length - zone.cards[enemy].length
  if (surplus <= 0) return true
  // Every guard ATTACK_ENEMY_BASE itself applies (spec §7.3). Neither
  // consumes the rider: "if this card leaves play WITHOUT DEALING DAMAGE,
  // draw a card" makes damage — not the activation — what spends it.
  if (zone.baseHp[enemy] <= 0) return true
  if (zone.cards[enemy].some((c) => c.keywords.includes(KEYWORDS.BLOCKER))) {
    game.state.log.push(`Zone ${zone.id}: a Blocker shields the base — ${card.name} deals nothing`)
    return true
  }
  // "40k damage" is materials, like every base-damage figure in this game
  // (design spec §3.4: floor(materialCost / 1000)). Derived, never written as
  // the HP number — a hard-coded 40 would silently break if either constant
  // moved.
  const damage = surplus * Math.floor(ONGOING_ATTRITION_DAMAGE_PER_VEHICLE / BASE_DAMAGE_DIVISOR)
  zone.baseHp[enemy] = Math.max(0, zone.baseHp[enemy] - damage)
  game.state.zoneEffects = game.state.zoneEffects.filter(
    (e) => !(e.effect === ONGOING_ATTRITION && e.zoneId === zone.id && e.side === actor),
  )
  game.state.log.push(
    `Zone ${zone.id}: ${card.name} grinds the base for ${damage} (${zone.baseHp[enemy]} HP remains)`,
  )
  if (zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${zone.id} has fallen`)
  checkVictory(game)
  return true
}

registerEffect(ONGOING_ATTRITION, (payload) => (
  payload.battle ? ongoingAttritionStrike(payload) : ongoingAttritionClaim(payload)
), { needsCatalog: true })

const RECURRING_THREAT = 'recurringThreatEffect'

// "Choose a friendly vehicle, destroy it. For the rest of the game, whenever
// you would fight a defensive fleet battle in the zone it was in, you may
// summon a copy of that vehicle to fight alongside your fleet in battle."
//
// Structurally DWG Waters' clause 2 with a different pool — a permanent
// zoneEffect whose rider offers a battle summon — so it keeps that card's
// shape: one registry name, occasions told apart by the payload, and the
// "alongside your fleet needs a fleet" guard.
//
// What is new is WHICH hull it summons. `ZoneEffect.data` carries the whole
// SnapshotCard rather than a name, because the engine's catalog is
// is_built_in only: a name-based lookup would fail for exactly the custom
// hulls a DWG player is likeliest to have designed. The stored value is
// discardSnapshotOf — the one derivation discardCard itself writes — so the
// remembered hull arrives already stripped of costDelta. A captured copy can
// never be remembered here at all: discardCard destroys it instead of filing
// a snapshot, so it has no wreck to call back.
//
// { needsCatalog: true } is still required, and not for the summon: the rider
// dispatch mints this card's own payload card from ctx.catalog by name.
const recurringThreatOffer = choice({
  effect: RECURRING_THREAT,
  prompt: 'Call the wreck back to fight alongside your fleet?',
  options: ({ game, actor, battle }) => {
    const remembered = recurringThreatHullsIn(game, actor, battle?.zoneId)
    return remembered.map((hull, i) => ({ id: `${i}`, label: hull.name }))
  },
  data: ({ game, actor, battle }) => ({
    zoneId: battle?.zoneId,
    // Stashed, never re-derived on the answer: the option ids are positional,
    // so the list they indexed must be the list that comes back
    // (docs/claude/card-effects.md, "Suspending for a choice").
    hulls: recurringThreatHullsIn(game, actor, battle?.zoneId),
  }),
  resolve: ({ game, actor, ctx, card, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    const hulls = pending?.data?.hulls
    if (typeof zoneId !== 'number' || !Array.isArray(hulls)) return false
    const snapshot = hulls[Number(choiceId)] as SnapshotCard | undefined
    if (!snapshot) return false
    const battle = game.state.activeBattle
    // The battle may have gone while the choice sat open.
    if (!battle || battle.zoneId !== zoneId) return false
    // No copyMeta here, and that is deliberate rather than an omission: the
    // stored snapshot came from discardSnapshotOf, and a captured copy never
    // reaches that function — discardCard destroys it first — so no
    // capturedCopy stamp can be present to strip.
    const hull = mintHull(game, ctx, snapshot)
    if (!joinBattle(game, actor, hull.instanceId, hull)) return false
    game.state.log.push(`${card.name} calls ${hull.name} back to the fight in zone ${zoneId}`)
    return true
  },
})

// Every hull this side has left a Recurring Threat marker for in one zone.
// A player may plant several markers on the same zone — each remembers its own
// hull — so this is a list rather than a lookup.
function recurringThreatHullsIn(
  game: EngineGame, actor: Side, zoneId: number | undefined,
): SnapshotCard[] {
  if (typeof zoneId !== 'number') return []
  return game.state.zoneEffects
    .filter((e) => e.effect === RECURRING_THREAT && e.zoneId === zoneId && e.side === actor)
    .map((e) => e.data?.summon)
    .filter((s): s is SnapshotCard => s !== undefined && s !== null && typeof s === 'object')
}

function recurringThreatRider(payload: EffectPayload): boolean {
  const { game, actor, battle } = payload
  if (!battle || battle.phase !== 'lock' || !battle.isDefender) return true
  const active = game.state.activeBattle
  const zone = zoneById(game.state, battle.zoneId)
  if (!active || !zone) return true
  // "Alongside your fleet" needs a fleet: at least one of the defender's own
  // BOARD hulls in this battle. DWG Waters' clause 3 declares a battle whose
  // only defender is a summoned guardian, and one zone can hold both markers.
  const hasFleet = active.defenderIds.some((id) => zone.cards[actor].some((c) => c.instanceId === id))
  if (!hasFleet) return true
  return recurringThreatOffer(payload)
}

function recurringThreatPlay(payload: EffectPayload): boolean {
  const { game, actor, ctx, card, targetInstanceId } = payload
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== actor) return false
  const { zone, entry } = found
  zone.cards[actor] = zone.cards[actor].filter((c) => c.instanceId !== targetInstanceId)
  game.state.zoneEffects.push({
    effect: RECURRING_THREAT, zoneId: zone.id, side: actor, cardName: card.name,
    setOnTurn: game.turnNumber, // no expiresOnTurn: "for the rest of the game"
    data: { summon: discardSnapshotOf(entry) },
  })
  discardCard(game, actor, entry)
  game.state.log.push(
    `${entry.name} is destroyed — it will answer defensive battles in zone ${zone.id} for the rest of the game`,
  )
  // LAST, deliberately: a death effect may draw, reshuffle the discard, or
  // suspend on a choice of its own, and none of that may interleave with the
  // writes above. "Destroy" fires it — spec §7.3, decision 28.
  fireDeathEffect(game, ctx, actor, entry)
  return true
}

registerEffect(RECURRING_THREAT, (payload) => {
  if (payload.resolution !== undefined) return recurringThreatOffer(payload)
  if (payload.battle) return recurringThreatRider(payload)
  return recurringThreatPlay(payload)
}, { needsCatalog: true })

const DWG_WATERS_EFFECT = 'dwgWatersEffect'

// "Choose a zone. For the rest of the game, whenever you fight a defensive
// battle in that zone, you may choose one DWG vehicle with a cost <60k from
// the game to fight alongside your fleet in that battle. If the enemy attacks
// you directly in this zone, you can force them to beat this ship in battle
// first before doing damage with their surviving vehicles."
//
// Three clauses behind ONE registry name, told apart by the payload — the same
// shape Trebuchet uses with `continuation`, and the reason it must stay one
// name: the zoneEffects entry stores the name it was claimed under, and that
// is what dispatches both riders once the card itself is spent (decision 22).
//
//   clause 1  no battle, no resolution      → claim the zone
//   clause 2  battle.phase === 'lock'       → offer a guest, then re-entry
//   clause 3  battle.phase === 'baseAttack' → intercept the bombardment

// "From the game" is the catalog, the same phrasing Special Foundries uses for
// a named pool (spec §7.3). This filters ctx.catalog directly rather than
// going through drawFromPool, so it uses the shared poolEligible predicate
// rather than drawFromPool's own filter.
function dwgGuestPool(ctx: EngineContext): SnapshotCard[] {
  return ctx.catalog.filter((c) =>
    c.isBuiltIn &&
    c.faction === 'DWG' &&
    c.type === 'vehicle' &&
    c.materialCost < DWG_WATERS_GUEST_MAX_COST &&
    poolEligible(c))
}

// Clause 2. Options are catalog card names — public, like Special Foundries'
// pools — so offering them leaks nothing (spec §4.2, departure 5).
const dwgWatersGuest = choice({
  effect: DWG_WATERS_EFFECT,
  prompt: 'Call in a DWG vehicle to fight alongside your fleet?',
  options: ({ ctx }) => dwgGuestPool(ctx).map((c) => ({ id: c.name, label: c.name })),
  data: ({ battle }) => ({ zoneId: battle?.zoneId }),
  resolve: ({ game, actor, ctx, card, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const battle = game.state.activeBattle
    // The battle may have gone while the choice sat open; and the pool is
    // re-derived rather than trusted, so a stale option cannot summon
    // something that is no longer eligible.
    if (!battle || battle.zoneId !== zoneId) return false
    if (!dwgGuestPool(ctx).some((c) => c.name === choiceId)) return false
    const hulls = summonHulls(game, ctx, choiceId, 1)
    if (!hulls) return false
    if (!joinBattle(game, actor, hulls[0].instanceId, hulls[0])) return false
    game.state.log.push(`${card.name} calls in a ${choiceId} to zone ${zoneId}`)
    return true
  },
})

function dwgWatersDefensiveGuest(payload: EffectPayload): boolean {
  const { game, actor, battle } = payload
  if (!battle || !battle.isDefender) return true
  const active = game.state.activeBattle
  const zone = zoneById(game.state, battle.zoneId)
  if (!active || !zone) return true
  // "Alongside your fleet" needs a fleet: at least one of the defender's own
  // board hulls in this battle. Without that check, clause 3's own battle —
  // where the only defender is the guardian clause 3 just summoned — would
  // also draw a clause-2 guest, and one card would put two hulls on the board
  // for a bombardment it had already cancelled.
  const hasFleet = active.defenderIds.some((id) => zone.cards[actor].some((c) => c.instanceId === id))
  if (!hasFleet) return true
  return dwgWatersGuest(payload)
}

// Clause 3 (spec §7.3). "Force them to beat this ship in battle FIRST before
// doing damage with their surviving vehicles" is a GATE, not a wall: the
// bombardment is deferred behind a fight the attacker can win, and if they win
// it their survivors still land the damage. The battle and the damage cannot
// share a turn — a zone admits one activation — so the second half rides on
// ActiveBattle.continuation and lands when the report is approved.
//
// Automatic rather than offered, because a declinable interception would let
// the defender void the attacker's activation and take no damage (decision 25).
function dwgWatersInterception(payload: EffectPayload): boolean {
  const { game, actor, ctx, card, battle } = payload
  if (!battle) return true
  // "If THE ENEMY attacks you directly in this zone." Since wave 5,
  // ATTACK_ENEMY_BASE dispatches the ATTACKER's own riders too (spec §4.3, DP2
  // departure 9), so `phase === 'baseAttack'` alone no longer means "I am being
  // bombarded". Without this, a claimant bombarding a zone they hold intercepts
  // their own attack — with the roles inverted, since everything below reads
  // `otherSide(actor)` as the aggressor.
  if (!battle.isDefender) return true
  if (game.state.activeBattle) return true // already intercepted by another rider
  const zone = zoneById(game.state, battle.zoneId)
  if (!zone) return true
  const aggressor = otherSide(actor)
  const strikers = baseStrikersIn(zone.cards[aggressor] as ZoneCardEntry[], game.turnNumber)
  const pool = dwgGuestPool(ctx)
  // No guardian to put up, or nothing to fight: let the bombardment through
  // rather than failing the attacker's action over the defender's card.
  if (strikers.length === 0 || pool.length === 0) return true
  const pick = pool[Math.floor(ctx.rng() * pool.length)]
  const guardian = summonHulls(game, ctx, pick.name, 1)
  if (!guardian) return true
  return declareForcedBattle(game, ctx, {
    zoneId: zone.id,
    aggressor,
    attackerIds: strikers.map((s) => s.instanceId),
    defenderIds: [guardian[0].instanceId],
    summons: guardian,
    cause: card.name,
    // The attacker chose ATTACK_ENEMY_BASE, which spends the zone's one
    // activation; the interception redirects that activation rather than
    // refunding it. Eclipse is the only other caller that passes this.
    activatesZone: true,
    // `side: aggressor` deliberately — the continuation belongs to the
    // ATTACKER's half of the card's sentence, and it is what makes
    // `battle.won` on the resolve context read "did the attacker beat the
    // guardian" rather than "did the claim holder survive".
    continuation: {
      effect: DWG_WATERS_EFFECT, side: aggressor, card,
      data: { zoneId: zone.id, strikerIds: strikers.map((s) => s.instanceId) },
    },
  })
}

// Clause 3's second half: the attacker beat the ship, so their surviving
// vehicles do the damage the interception deferred. Fires from
// DECIDE_BATTLE_REPORT once the interception battle resolves.
//
// `battle.won` is the aggressor's, because the continuation names them as its
// side. The guardian is the only defender, so winning IS beating the ship.
function dwgWatersAftermath(payload: EffectPayload): boolean {
  const { game, actor, continuation, battle } = payload
  const zoneId = continuation?.data?.zoneId
  const stashed = continuation?.data?.strikerIds
  if (typeof zoneId !== 'number' || !Array.isArray(stashed)) return true
  if (!battle || !battle.won) return true // the ship held, or it was a draw
  const zone = zoneById(game.state, zoneId)
  if (!zone) return true
  const enemy = otherSide(actor)
  // Re-apply every guard ATTACK_ENEMY_BASE itself would, against the board as
  // it stands NOW: a base already destroyed takes nothing more, and a Blocker
  // that reached the zone during the battle still protects it.
  if (zone.baseHp[enemy] <= 0) return true
  if (zone.cards[enemy].some((c) => c.keywords.includes(KEYWORDS.BLOCKER))) {
    game.state.log.push(`Zone ${zoneId}: a Blocker shields the base — the deferred bombardment is called off`)
    return true
  }
  // "With their surviving vehicles": the strikers this battle started with,
  // minus whoever died in it. baseDamageFrom re-applies the sub / Inoffensive
  // / freshly-deployed filters, so the roster stays the same one the original
  // attack was measured against.
  const survivors = (zone.cards[actor] as ZoneCardEntry[]).filter((c) => stashed.includes(c.instanceId))
  const damage = baseDamageFrom(survivors, game.turnNumber)
  if (damage <= 0) return true
  zone.baseHp[enemy] = Math.max(0, zone.baseHp[enemy] - damage)
  game.state.log.push(
    `Zone ${zoneId}: the guardian is beaten — bombardment for ${damage} (${zone.baseHp[enemy]} HP remains)`,
  )
  if (zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${zoneId} has fallen`)
  checkVictory(game)
  return true
}

// Clause 1: the marker itself — persistent state plus the board badge.
function dwgWatersClaim({ game, actor, card, targetZoneId }: EffectPayload): boolean {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  if (!zone) return false
  // Re-claiming a zone you already hold would buy nothing — reject before the
  // handler commits, so the materials are not spent on a no-op.
  const held = game.state.zoneEffects.some(
    (e) => e.effect === DWG_WATERS_EFFECT && e.zoneId === targetZoneId && e.side === actor,
  )
  if (held) return false
  game.state.zoneEffects.push({
    effect: DWG_WATERS_EFFECT, zoneId: targetZoneId, side: actor,
    cardName: card.name, setOnTurn: game.turnNumber,
  })
  game.state.log.push(
    `Zone ${targetZoneId} becomes DWG Waters for player ${actor.toUpperCase()} — for the rest of the game`,
  )
  return true
}

registerEffect(DWG_WATERS_EFFECT, (payload) => {
  if (payload.resolution !== undefined) return dwgWatersGuest(payload)
  // The interception's own battle resolving — clause 3's second half. Checked
  // before the phase branches: a continuation carries a 'resolve' context, and
  // only `continuation` tells it apart from an ordinary resolve trigger.
  if (payload.continuation !== undefined) return dwgWatersAftermath(payload)
  if (payload.battle?.phase === 'lock') return dwgWatersDefensiveGuest(payload)
  if (payload.battle?.phase === 'baseAttack') return dwgWatersInterception(payload)
  return dwgWatersClaim(payload)
}, { needsCatalog: true })

// "When played, refresh one of your hero powers then gain 1cp." With no used
// power there is nothing to refresh, and `choice` resolves without suspending
// so the CP still lands.
const KRAKEN = 'krakenOnPlay'
registerEffect(KRAKEN, choice({
  effect: KRAKEN,
  prompt: 'Refresh one of your used hero powers',
  options: ({ game, actor }) =>
    game.state.usedHeroPowers[actor].map((p) => ({ id: p, label: HERO_POWER_LABELS[p] ?? p })),
  resolve: ({ game, actor }, choiceId) => {
    if (choiceId === null) {
      game.state.log.push('Kraken finds no used hero power to refresh')
    } else {
      game.state.usedHeroPowers[actor] = game.state.usedHeroPowers[actor].filter((p) => p !== choiceId)
      game.state.log.push(`Kraken refreshes ${HERO_POWER_LABELS[choiceId] ?? choiceId}`)
    }
    game.state.resources[actor].cp += 1
    return true
  },
}))

// "Choose an enemy vehicle, that vehicle fights alone against a flying
// squirrel (3x squadron)." DP3 (spec §4.3): the target is the sole defender
// (§7.3 "fights alone") against FLYING_SQUIRREL_ATTACK_COUNT freshly minted
// Flying Squirrel summons, which exist only for this battle (spec §4.4) — the
// aggressor is the player who played the card, not the target's owner.
registerEffect('flyingSquirrelAttackEffect', ({ game, actor, ctx, targetInstanceId, card }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const summons = summonHulls(game, ctx, 'Flying Squirrel', FLYING_SQUIRREL_ATTACK_COUNT)
  if (!summons) return false
  return declareForcedBattle(game, ctx, {
    zoneId: found.zone.id,
    aggressor: actor,
    attackerIds: summons.map((s) => s.instanceId),
    defenderIds: [targetInstanceId],
    summons,
    cause: card.name,
  })
}, { needsCatalog: true })

// "Choose an enemy vehicle. Start a battle with that vehicle vs all your
// vehicles from the same zone." DP3: the target is the sole defender (§7.3);
// the attackers are the actor's own vehicles already in that zone, minus any
// Inoffensive ones (§7.3 — Inoffensive means "cannot attack", and a forced
// battle is not licence to break that). No summons. If that leaves no
// attacker, declareForcedBattle's own empty-list check fails the play.
registerEffect('gangUpEffect', ({ game, actor, ctx, targetInstanceId, card }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const attackerIds = found.zone.cards[actor]
    .filter((c) => !c.keywords.includes(KEYWORDS.INOFFENSIVE))
    .map((c) => c.instanceId)
  return declareForcedBattle(game, ctx, {
    zoneId: found.zone.id,
    aggressor: actor,
    attackerIds,
    defenderIds: [targetInstanceId],
    cause: card.name,
  })
})
