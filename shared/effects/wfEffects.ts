import {
  AMBUSH_DISTANCE_M, SPAWN_DISTANCE_MIN_M,
  ALL_FOR_THE_CAUSE_DOUBLE_COST, CARD_TYPES, EXCRUCIATOR_COST_DELTA, EXCRUCIATOR_DRAW_COUNT,
  HARBRINGER_GUEST_MAX_COST, JUDGEMENT_DISCOUNT, KEYWORDS,
  MARTYR_ATTACK_BOOST_MIN_COST,
  MARTYR_ATTACK_BOOSTED_COUNT, MARTYR_ATTACK_COUNT, SLASHER_EARTH_RAKER_COUNT, VEHICLE_TYPES,
} from '../gameSettings.ts'
import type { EngineContext, EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import type { SnapshotCard } from '../engine/gameInit.ts'
import { discardCard, findVehicle, otherSide, zoneById } from '../engine/gameEngine.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import {
  catalogCard, choice, enemyVehicleOptions, grant, poolEligible, shuffled, spawnInto, summonHulls,
} from './primitives.ts'
import { registerCostModifier, registerEffect } from './registry.ts'
import type { EffectPayload } from './registry.ts'

// WF built-in card effects.

// "When played, draw two AI vehicles from your deck and reduce their cost by
// 100k."
//
// "AI vehicle" is isBuiltIn === true, NOT a faction (spec R-5). That is what
// repairmenReadyEffect already compares for the identical printed phrase, and
// what Air Strafe, Excalibur and Martyr Attack all read. The 2026-09-02 pass
// narrows Repairmen Ready and Excalibur to faction === 'SS' and deliberately
// leaves THIS card on the built-in meaning — and it is emphatically NOT a WF
// filter, which is the plausible-looking wrong answer R-5 exists to forbid.
//
// It reads the owner's OWN DECK, so it takes NO { needsCatalog: true }:
// nothing here touches ctx.catalog, and "it draws cards" is not the test for
// that flag. Trondheim and Resolute draw from the deck too and carry none.
//
// Hand-rolled rather than drawFromPool because the discount has to land on the
// cards that were actually drawn, and drawFromPool tells its caller nothing
// about what it took. It still borrows drawFromPool's own `shuffled`, so both
// deck draws pick the same way — off ctx.rng, never Math.random.
//
// The reduction is a PRICE, not a rewrite (balmungOnPlay's ruling, and
// slasherOnPlay's above): costDelta is summed into effectiveCostInGame and
// never reaches effectiveMaterialCostOf — which is what base damage
// (baseAttack.ts), repair cost (battleResolve.ts) and upkeep (costs.ts) all
// read. A rewritten materialCost would quietly change a drawn hull's damage
// and repair bill, which the card text does not say.
//
// The stamp is deliberately NOT clamped: effectiveCostInGame floors the price
// at zero with its own Math.max, so a hull cheaper than 100k is free rather
// than negative, while a stamp clamped here would make a second, later
// discount depend on the order the two landed.
registerEffect('excruciatorOnPlay', ({ game, actor, card, ctx }) => {
  const deck = game.privates[actor].deck
  const pool = deck.filter((c) => c.isBuiltIn && c.type === CARD_TYPES.VEHICLE)
  let taken = 0
  // `deck` IS game.privates[actor].deck, so splice mutates in place and needs
  // no reassignment.
  for (const pick of shuffled(pool, ctx).slice(0, EXCRUCIATOR_DRAW_COUNT)) {
    const index = deck.findIndex((c) => c.instanceId === pick.instanceId)
    if (index < 0) continue
    const [drawn] = deck.splice(index, 1)
    const current = typeof drawn.meta.costDelta === 'number' ? drawn.meta.costDelta : 0
    drawn.meta = { ...drawn.meta, costDelta: current + EXCRUCIATOR_COST_DELTA }
    game.privates[actor].hand.push(drawn)
    taken++
  }
  // A direct push does not resync the public counts for you (drawCard does),
  // and BOTH move here: cards left the deck as well as entering the hand.
  game.state.counts[actor] = {
    hand: game.privates[actor].hand.length,
    deck: deck.length,
  }
  // A deck that cannot supply two is routine rather than a data bug, so this
  // resolves instead of failing the play — the same contract drawFromPool's
  // deck source has. The drawn cards are never NAMED: state.log is public and
  // they are entering a hidden hand.
  game.state.log.push(
    `${card.name} pulls ${taken} vehicle(s) out of player ${actor.toUpperCase()}'s own deck at a discount`,
  )
  return true
})

// Orphaned by the 2026-08-30 balance pass, which rewrote Purifier's text and
// cleared its meta. Kept registered rather than deleted: a game dealt before
// that pass carries a frozen snapshot still naming it, and the name must never
// be reused for anything else (spec §9.2, the Kraken/Paddlegun collision).
registerEffect('purifierEffect', grant({ draw: 1 }))
// "When this is destroyed, draw a card." Basher prints no keywords, so it
// cannot hit the SCRAPPY-plus-onDeathEffect prohibition that cost Loggerhead
// its keyword (docs/claude/card-effects.md).
registerEffect('basherOnDeath', grant({ draw: 1 }))
// "When this is played, draw a card." Earth Raker prints STEALTHY and nothing
// else, so the SCRAPPY-plus-death-trigger question does not arise — and this is
// an on-play trigger in any case.
registerEffect('earthRakerOnPlay', grant({ draw: 1 }))

// "Target an enemy submarine, remove it from play."
//
// OW Sub Killer's shape (owEffects.ts) with the GT clause and the zone rider
// removed and the target list narrowed from sub/plane/airship to SUB alone. It
// carries its OWN registry id even though the body is nearly identical: a name
// two cards could share silently rebinds one of them the moment the other
// changes (spec R-6, the Kraken/Paddlegun collision).
//
// ⚠ REMOVE FROM PLAY IS NOT DESTROY (spec R-7). The hull leaves its zone and
// goes out of play through discardCard — the single exit, so a summonOnly hull
// still never reaches a discard and a captured copy is still destroyed — but it
// is never pushed to destroyedEntries, and destroyedEntries is exactly what
// fireDeathEffect walks. In battleResolve.ts those two statements are adjacent
// lines; the difference between them is invisible in review, so it has its own
// test.
//
// No `if (battle)` guard, unlike Sub Killer: that card's guard exists because
// it plants a state.zoneEffects rider and is therefore re-dispatched at every
// lock. This one plants nothing and is never re-entered.
registerEffect('subStrikeEffect', ({ game, actor, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  if (found.entry.vehicleType !== VEHICLE_TYPES.SUB) return false
  const enemy = found.side
  found.zone.cards[enemy] = found.zone.cards[enemy].filter((c) => c.instanceId !== targetInstanceId)
  discardCard(game, enemy, found.entry)
  // The hull was public on the board a moment ago, so naming it leaks nothing.
  game.state.log.push(`${found.entry.name} is removed from play in zone ${found.zone.id}`)
  return true
})

// "When played, put an ambush card into your hand."
//
// balmungOnPlay's shape (ssEffects.ts) minus the discount — Ambush is already
// a 0/0 ability, so there is nothing to reduce. Buzzsaw's whole text used to be
// `defensiveOmission`; that key is gone and STEALTHY replaces it on the card.
//
// poolEligible rather than a hand-rolled summonOnly check (Wave 0): this
// filters the catalog by NAME directly rather than through drawFromPool, which
// is the one place that guard comes for free.
//
// { needsCatalog: true } is NOT optional. game-action fetches a catalog only
// for names in CATALOG_EFFECTS; without the flag this runs against an empty one
// and 400s on every real play, while every unit test here passes against
// makeCtx's hand-built catalog. factionEffects.test.ts asserts membership at
// runtime, which is the only way to check a flag rather than a comment.
registerEffect('buzzsawOnPlay', ({ game, actor, card, ctx }) => {
  const ambush = catalogCard(ctx, 'Ambush')
  // A named card the catalog cannot supply is a data bug, not an empty pool, so
  // this fails the play rather than fizzling — spawnVehicles' contract.
  if (!ambush || !poolEligible(ambush)) return false
  const hand = game.privates[actor].hand
  hand.push({ ...ambush, instanceId: ctx.newId() })
  // A direct push does not resync the public counts for you (drawCard does).
  game.state.counts[actor].hand = hand.length
  // Never named: state.log is public and this card is entering a hidden hand.
  game.state.log.push(`${card.name} slips a card into player ${actor.toUpperCase()}'s hand`)
  return true
}, { needsCatalog: true })

// "When this is played, add two earth rakers to your hand. they cost 0."
//
// balmungOnPlay's shape, twice, and with balmungOnPlay's ruling on what "cost
// 0" means: a costDelta PRICE, never a rewritten materialCost. costDelta is
// summed into effectiveCostInGame and never reaches effectiveMaterialCostOf, so
// a free Earth Raker still deals its printed base damage and still costs its
// printed repair — which is exactly what "they cost 0" says. loggerheadOnDeath
// DOES mint at materialCost: 0 and is not the precedent: its copy goes into a
// DECK, where nothing but the price ever reads that number.
//
// ⚠ The seeded card is 'Earth Raker', two words. 'EarthRaker' compiles, reviews
// clean and returns null.
registerEffect('slasherOnPlay', ({ game, actor, card, ctx }) => {
  const raker = catalogCard(ctx, 'Earth Raker')
  if (!raker || !poolEligible(raker)) return false
  const hand = game.privates[actor].hand
  for (let i = 0; i < SLASHER_EARTH_RAKER_COUNT; i++) {
    hand.push({
      ...raker,
      instanceId: ctx.newId(),
      meta: { ...raker.meta, costDelta: -raker.materialCost },
    })
  }
  game.state.counts[actor].hand = hand.length
  // Never named: state.log is public and these are entering a hidden hand.
  game.state.log.push(
    `${card.name} slips ${SLASHER_EARTH_RAKER_COUNT} cards into player ${actor.toUpperCase()}'s hand, free of charge`,
  )
  return true
}, { needsCatalog: true })

const AMBUSH = 'ambushEffect'

// "Choose a zone. During the next offensive battle you fight there this turn,
// you may deploy your ships after the defending player and you may position
// your ships 600m closer to the enemy. If the turn ends and you have not
// fought in that zone, draw a card."
//
// DP5's zone half (spec §4.3, "DP5 as wave 5 built it"). One registry name,
// three occasions told apart by the payload — the shape dwgWatersEffect
// established, and the reason it must stay one name: the zoneEffects entry
// stores the name it was claimed under, and that is what dispatches the rider
// once the card itself is spent.
//
//   no battle, no resolution     → claim the zone
//   battle.phase === 'lock',
//     and we are the aggressor   → spend the rider, then offer
//   resolution                   → apply what was offered
//
// The tail ("draw if the turn ends unused") is endTurn's, driven by
// data.drawOnExpiry — see gameEngine.ts's turnEndRiders.
//
// { needsCatalog: true } is NOT optional and NOT about this effect's own
// needs: the rider dispatch mints its payload card from ctx.catalog by
// cardName, so without the flag game-action never loads a catalog and the
// rider is silently skipped in production while every unit test passes.
function ambushClaim({ game, actor, card, targetZoneId }: EffectPayload): boolean {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  if (!zone) return false
  // A second ambush on a zone you already hold one in buys nothing — refuse
  // before the handler commits, so the play is not spent on a no-op
  // (dwgWatersClaim refuses a re-claim for the same reason).
  const held = game.state.zoneEffects.some(
    (e) => e.effect === AMBUSH && e.zoneId === targetZoneId && e.side === actor,
  )
  if (held) return false
  game.state.zoneEffects.push({
    effect: AMBUSH, zoneId: targetZoneId, side: actor, cardName: card.name,
    setOnTurn: game.turnNumber,
    // "this turn" / "if the turn ends": both halves expire together, at this
    // player's own END_TURN (spec §7.3).
    expiresOnTurn: game.turnNumber,
    data: { drawOnExpiry: true },
  })
  game.state.log.push(
    `Player ${actor.toUpperCase()} sets an ambush in zone ${targetZoneId} — for the rest of the turn`,
  )
  return true
}

// The offer. Both printed permissions ride on one yes/no: the deploy order is
// a rule the players apply in From The Depths (the log line is how the
// DEFENDER learns of it, which is why it must be public), and the distance is
// the half the engine can actually hold.
const ambushOffer = choice({
  effect: AMBUSH,
  prompt: 'Spring your ambush — deploy after the defender, and start 600m closer?',
  options: () => [{ id: 'spring', label: `Deploy last, ${AMBUSH_DISTANCE_M}m closer` }],
  data: ({ battle }) => ({ zoneId: battle?.zoneId }),
  resolve: ({ game, actor, card, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const battle = game.state.activeBattle
    // The battle may have gone while the choice sat open.
    if (!battle || battle.zoneId !== zoneId) return false
    // Clamped exactly as tacticalPositioning clamps — but distanceModifiedBy
    // is deliberately untouched: that list is the hero power's once-per-side
    // ledger, and a card must not spend it (spec §7.3).
    battle.distanceM = Math.max(SPAWN_DISTANCE_MIN_M, battle.distanceM - AMBUSH_DISTANCE_M)
    game.state.log.push(
      `${card.name}: player ${actor.toUpperCase()} deploys after the defender, at ${battle.distanceM}m`,
    )
    return true
  },
})

// "The NEXT offensive battle you fight there this turn." A bombardment is not
// a battle fought, so only phase 'lock' springs it — which is also what makes
// the "you have not fought in that zone" tail read correctly.
function ambushSpring(payload: EffectPayload): boolean {
  const { game, actor, battle } = payload
  if (!battle || battle.phase !== 'lock' || battle.isDefender) return true
  const before = game.state.zoneEffects.length
  // Spent BEFORE the offer is made, not after it is answered: the card's
  // compensation clause is "if the turn ends and you have not FOUGHT there",
  // so a decline — or an offer dropped for an occupied slot (spec §4.3, DP2
  // departure 4) — still spends it.
  game.state.zoneEffects = game.state.zoneEffects.filter(
    (e) => !(e.effect === AMBUSH && e.zoneId === battle.zoneId && e.side === actor),
  )
  if (game.state.zoneEffects.length === before) return true
  return ambushOffer(payload)
}

registerEffect(AMBUSH, (payload) => {
  if (payload.resolution !== undefined) return ambushOffer(payload)
  if (payload.battle) return ambushSpring(payload)
  return ambushClaim(payload)
}, { needsCatalog: true })

// "Choose a zone. Give all friendly vehicles in that zone the TEMPORARY
// keyword, then spawn a Martyr for each vehicle affected. If the vehicle
// costed more than 250k, summon two instead."
//
// The occupant list is snapshotted before spawning: spawnInto pushes into the
// same array, so iterating it live would stamp the new Martyrs Temporary and
// spawn Martyrs for Martyrs.
registerEffect('allForTheCauseEffect', ({ game, actor, ctx, targetZoneId }) => {
  const zone = game.state.zones.find((z) => z.id === targetZoneId)
  if (!zone) return false
  const martyr = catalogCard(ctx, 'Martyr')
  if (!martyr) return false

  const affected = [...zone.cards[actor]] as ZoneCardEntry[]
  if (affected.length === 0) {
    game.state.log.push('All for the Cause finds no friendly vehicles in that zone')
    return true
  }

  let spawned = 0
  for (const entry of affected) {
    if (!entry.keywords.includes(KEYWORDS.TEMPORARY)) {
      entry.keywords = [...entry.keywords, KEYWORDS.TEMPORARY]
    }
    const copies = entry.materialCost > ALL_FOR_THE_CAUSE_DOUBLE_COST ? 2 : 1
    for (let i = 0; i < copies; i++) {
      if (spawnInto(game, ctx, actor, zone.id, martyr)) spawned++
    }
  }
  game.state.log.push(
    `All for the Cause: ${affected.length} vehicle(s) go Temporary and ${spawned} Martyr(s) answer in zone ${zone.id}`,
  )
  return true
}, { needsCatalog: true })

// "Choose an enemy vehicle. It enters a fight alone against 4 Martyrs. If it
// is an airship, or a player design costing 400k+, it fights 6 Martyrs
// instead." DP3 (spec §4.3): the target is the sole defender (§7.3) against
// freshly minted Martyr summons (spec §4.4). "Player design" is
// isBuiltIn === false (spec §7.3); the airship clause is independent of cost
// — a built-in airship of any price still gets the boosted count. The cost
// check reads the printed materialCost, never effectiveMaterialCostOf — a
// Half-Cost target must not slip under the threshold.
registerEffect('martyrAttackEffect', ({ game, actor, ctx, targetInstanceId, card }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== otherSide(actor)) return false
  const { entry } = found
  const boosted = entry.vehicleType === VEHICLE_TYPES.AIRSHIP ||
    (entry.isBuiltIn === false && entry.materialCost >= MARTYR_ATTACK_BOOST_MIN_COST)
  const count = boosted ? MARTYR_ATTACK_BOOSTED_COUNT : MARTYR_ATTACK_COUNT
  const summons = summonHulls(game, ctx, 'Martyr', count)
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

const HARBRINGER = 'harbringerBattle'

// "Whenever this ship is in fleet combat, you may spawn in one WF ship that
// costs <=100k to join the battle."
//
// DWG Waters' clause 2 on a PARTICIPANT rather than a rider (spec §7.3,
// wave 6). DP2's lock pass already reaches participants on both sides, so
// this needs no zoneEffects entry and no rider dispatch — but it still needs
// { needsCatalog: true }, because unlike a rider it genuinely reads the
// catalog for its own pool.
//
// "In fleet combat" reads to every battle it fights: offensive, defensive and
// forced alike (§7.3's Catshark ruling — a battle it participates in is a
// battle whatever declared it). So there is deliberately NO isDefender guard.
// The isParticipant guard is not redundant with it: a DP2 effect can also be
// reached as a forced-battle bystander, and this card's text describes only a
// battle it is in.

// This filters ctx.catalog directly rather than going through drawFromPool,
// so it uses the shared poolEligible predicate rather than drawFromPool's
// own filter.
function harbringerPool(ctx: EngineContext): SnapshotCard[] {
  return ctx.catalog.filter((c) =>
    c.isBuiltIn &&
    c.faction === 'WF' &&
    c.type === 'vehicle' &&
    c.vehicleType === VEHICLE_TYPES.SHIP &&
    c.materialCost <= HARBRINGER_GUEST_MAX_COST &&
    poolEligible(c))
}

// Options are catalog card NAMES — public, like Special Foundries' pools and
// DWG Waters' guest list, so offering them leaks nothing (spec §4.2,
// departure 5).
const harbringerOffer = choice({
  effect: HARBRINGER,
  prompt: 'Spawn in a WF ship to join this battle?',
  options: ({ ctx }) => harbringerPool(ctx).map((c) => ({ id: c.name, label: c.name })),
  data: ({ battle }) => ({ zoneId: battle?.zoneId }),
  resolve: ({ game, actor, ctx, card, pending }, choiceId) => {
    // Empty pool: nothing to spawn, and nothing to fail.
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const battle = game.state.activeBattle
    // The battle may have gone while the choice sat open; and the pool is
    // re-derived rather than trusted, so a stale option cannot spawn
    // something that is no longer eligible.
    if (!battle || battle.zoneId !== zoneId) return false
    if (!harbringerPool(ctx).some((c) => c.name === choiceId)) return false
    const hulls = summonHulls(game, ctx, choiceId, 1)
    if (!hulls) return false
    // Membership in attackerIds/defenderIds is what decides a summon's side
    // (spec §4.4, decision 18), and joinBattle picks the list off `actor` —
    // so Harbringer's guest always fights on Harbringer's own side.
    if (!joinBattle(game, actor, hulls[0].instanceId, hulls[0])) return false
    game.state.log.push(`${card.name} spawns in a ${choiceId} to fight in zone ${zoneId}`)
    return true
  },
})

registerEffect(HARBRINGER, (payload) => {
  if (payload.resolution !== undefined) return harbringerOffer(payload)
  const { battle } = payload
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant) return true
  return harbringerOffer(payload)
}, { needsCatalog: true })

// "While your opponent has a submarine or airship, this card costs 100k less.
// Each turn, you may pay 1cp to have this vehicle 1v1 an enemy submarine or
// airship in this zone."
//
// Two clauses, two mechanisms, and the SCOPE of each is what tells them apart
// (spec §7.3, wave 6): the discount names no zone and reads the whole enemy
// board; the duel says "in this zone" and reads one. The contrast inside a
// single card is the evidence for both halves.
const JUDGEMENT_PREY = [VEHICLE_TYPES.SUB, VEHICLE_TYPES.AIRSHIP] as readonly string[]

// A flat discount, never per-hull: the text says "a submarine or airship", and
// one is as much a reason as three. CostModifierFn already receives the whole
// state and the pricing side, so scanning the other side costs nothing.
registerCostModifier('judgementCostModifier', (state, side) => {
  const enemy = otherSide(side)
  const found = state.zones.some(
    (z) => z.cards[enemy].some((c) => JUDGEMENT_PREY.includes(c.vehicleType ?? '')),
  )
  return found ? -JUDGEMENT_DISCOUNT : 0
})

const JUDGEMENT = 'judgementActivate'

// Braveheart's shape with a vehicleType filter (DP1 + DP4 + DP3). "Each turn"
// needs no code: ACTIVATE_VEHICLE pays the CP and stamps activatedOnTurn
// BEFORE this ever runs, so once-per-turn is already enforced.
//
// Like Braveheart, no `data` stash is needed and none is trusted from the
// client: payload.card on BOTH entries IS the activating hull, so its zone is
// re-derived identically in options() and resolve() rather than read off
// RESOLVE_PENDING_EFFECT's unvalidated fields. ACTIVATE_VEHICLE passes
// action.zoneId straight through as targetZoneId, which is exactly why this
// must not read it.
function judgementSelf(game: EngineGame, actor: Side, card: { instanceId: string }) {
  const found = findVehicle(game.state, card.instanceId)
  return found && found.side === actor ? found : null
}

registerEffect(JUDGEMENT, choice({
  effect: JUDGEMENT,
  prompt: 'Choose an enemy submarine or airship for Judgement to fight',
  options: ({ game, actor, card }) => {
    const self = judgementSelf(game, actor, card)
    return self
      ? enemyVehicleOptions(game, actor, self.zone.id, (e) => JUDGEMENT_PREY.includes(e.vehicleType ?? ''))
      : []
  },
  resolve: (payload, choiceId) => {
    const { game, actor, card, ctx } = payload
    if (choiceId === null) return false // nothing eligible in the zone — nothing to fight
    const self = judgementSelf(game, actor, card)
    if (!self) return false
    // Defence in depth, and a surviving mutation showed it is ONLY that:
    // declareForcedBattle re-validates every listed id against the board on
    // its own side in this zone, which subsumes every case this catches. Kept
    // because braveheartActivate carries the identical line and the two cards
    // should not diverge — but do not go hunting for the test that pins it.
    const stillLegal = enemyVehicleOptions(
      game, actor, self.zone.id, (e) => JUDGEMENT_PREY.includes(e.vehicleType ?? ''),
    ).some((o) => o.id === choiceId)
    if (!stillLegal) return false
    // No activatesZone: a forced battle is not a zone activation (spec §4.3).
    return declareForcedBattle(game, ctx, {
      zoneId: self.zone.id,
      aggressor: actor,
      attackerIds: [card.instanceId],
      defenderIds: [choiceId],
      cause: card.name,
    })
  },
}))
