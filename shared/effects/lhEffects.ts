import { effectiveCostInGame } from '../engine/placement.ts'
import { addCharge, hasChargeRoom } from '../engine/charge.ts'
import { dealBaseDamage } from '../engine/baseAttack.ts'
import {
  AMPERE_PLAY_CHARGE, BYTE_PLAY_CHARGE, DATA_BURST_DRAW, FACTIONS, IMPEDANCE_BEAM_DAMAGE, KEYWORDS, OVERCHARGE_CHARGE,
  SUPERRADIANCE_BEAM_DAMAGE, TERAWATT_TRANSFER_CHARGE, UMBRA_SALVO_DAMAGE, VEHICLE_TYPES, VOLTA_JUMP_START_CHARGE,
  WATT_PLAY_CHARGE,
} from '../gameSettings.ts'
import {
  catalogCard, choice, drawFromPool, enemyVehicleOptions, friendlyVehicleOptions, grant, poolEligible, sequence,
  spawnInto, spawnVehicles, summonHulls, whenPlayed, zoneOccupants,
} from './primitives.ts'
import type { EffectFn, EffectPayload } from './registry.ts'
import { registerEffect } from './registry.ts'
import { findVehicle, grantKeywordsTo, otherSide, putInHand, revokeKeywordsFrom, zoneById } from '../engine/gameEngine.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import { isStunned, stunHull } from '../engine/stun.ts'
import type { EngineGame, Side, ZoneCardEntry } from '../engine/engineTypes.ts'
import { isShipClass } from '../vehicleClass.ts'
import { zoneCapFor } from '../engine/zoneCapacity.ts'

// LH built-in card effects.

// The "[TG] Robotics" pool — the four TG ships LH borrows, marked in
// LH-Built-in.js rather than selected by faction (spec §7.3, ruling L-1).
//
// ⚠ This filter used to read `{ faction: 'TG' }`, and the catalog it filters
// is the WHOLE cards table (game-action's probe is
// `.eq('is_built_in', true)`, with no faction scoping and no scoping to the
// decks in play). So the pool was the query
// `where is_built_in and faction = 'TG'` — four rows before wave 7 and thirty
// after it, with no edit to this file and none that could have been withheld.
// Putting the new cards in the TG faction is not what AVOIDS that; it is what
// CAUSES it. The marker is what holds the pool at four.
//
// ⚠ There are TWO filters, not one: this, and roboticAssemblersEffect's own
// inline one further down. Fixing only this leaves Robotic Assemblers offering
// all 28 — in a dialog whose options are public to both players.
const LH_ROBOTICS_POOL = 'lhRoboticsPool'
const tgRobotics = drawFromPool({ source: 'catalog', filter: { metaFlag: LH_ROBOTICS_POOL }, count: 1 })
registerEffect('ampereOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('candelaOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('quadrupoleOnPlay', tgRobotics, { needsCatalog: true })
registerEffect('coulombEffect', grant({ draw: 1 }))

// "a player made ship or tank" — two pool draws behind one name, so
// PoolFilter does not need a multi-value vehicleType for a single card.
const drawCustomShip = drawFromPool({
  source: 'deck', filter: { isBuiltIn: false, vehicleType: 'ship' }, count: 1, allowEmpty: true,
})
const drawCustomTank = drawFromPool({
  source: 'deck', filter: { isBuiltIn: false, vehicleType: 'tank' }, count: 1, allowEmpty: true,
})
const conduitOnDeath: EffectFn = (payload) => {
  const before = payload.game.privates[payload.actor].hand.length
  drawCustomShip(payload)
  if (payload.game.privates[payload.actor].hand.length > before) return true
  return drawCustomTank(payload)
}
registerEffect('conduitEffect', conduitOnDeath)

// "When this vehicle is played into an empty zone, draw a card and refund
// its cost." Recomputing the cost is exact here: Sapphire carries no
// costModifier, so nothing about it depends on board state.
registerEffect('sapphireEffect', whenPlayed(
  (p) => zoneOccupants(p, 'either')?.length === 0,
  sequence(
    grant({ draw: 1 }),
    ({ game, actor, card }) => {
      game.state.resources[actor].materials += effectiveCostInGame(game.state, actor, card, game.turnNumber)
      game.state.log.push(`${card.name} slips in unopposed — its cost is refunded`)
      return true
    },
  ),
))

// Spec §7.2 authors this card's text: "Once per turn, you may pay 1cp to draw
// a random card from the [TG] Robotics pool." Same pool as Ampere's.
registerEffect('spectrumEffect', tgRobotics, { needsCatalog: true })

// "Choose a [TG] Robotics card to add to your hand." All four are public, so
// offering them by name leaks nothing.
//
// ⚠ The SECOND of the pool's two filters (see tgRobotics above). It is
// hand-rolled rather than a drawFromPool spec, so the marker has to be applied
// here separately — and this is the one whose failure is loudest, because
// pendingEffect.options lives in PublicGameState and both players scroll it.
const ROBOTIC_ASSEMBLERS = 'roboticAssemblersEffect'
registerEffect(ROBOTIC_ASSEMBLERS, choice({
  effect: ROBOTIC_ASSEMBLERS,
  prompt: 'Choose a [TG] Robotics card to add to your hand',
  options: ({ ctx }) => ctx.catalog
    .filter((c) => c.isBuiltIn && c.meta[LH_ROBOTICS_POOL] === true && poolEligible(c))
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((c) => ({ id: c.cardId, label: c.name })),
  resolve: ({ game, actor, ctx }, choiceId) => {
    const pick = ctx.catalog.find((c) => c.cardId === choiceId)
    // An empty catalog here is an infrastructure bug, not an empty pool.
    if (!pick) return false
    putInHand(game, actor, { ...pick, instanceId: ctx.newId() })
    game.state.log.push(`Player ${actor.toUpperCase()} adds a card to their hand`)
    return true
  },
}), { needsCatalog: true })

// "Spawn a friendly Sapphire into each zone. They have MOBILE and STEALTHY
// keywords." Sapphire already prints both, so the stamp is idempotent and
// kept only because the card text asks for it. Sapphire's own onPlayEffect
// does NOT fire — spawning is not playing (spec §7.4) — which is what keeps a
// 90k ability from also drawing three cards and refunding 90k.
registerEffect('sapphireScreenEffect', spawnVehicles({
  cardName: 'Sapphire',
  count: 1,
  zones: 'all',
  keywords: [KEYWORDS.MOBILE, KEYWORDS.STEALTHY],
}), { needsCatalog: true })

// "Choose one: Spawn a friendly orbit into any zone and give it the TEMPORARY
// keyword, or choose one enemy vehicle and have it fight alone against an
// orbit." Two chained suspensions (spec §4.2/§4.4) behind ONE registry name:
// RESOLVE_PENDING_EFFECT nulls pendingEffect before re-entering, which is
// exactly what lets this continuation suspend a second time.
//
// The two modes are two DIFFERENT mechanisms, and this card is the evidence
// the split lives in the data (spec §4.4): mode (a) is a board spawn
// (spawnVehicles — the Orbit enters zone.cards and stays there; the printed
// Orbit already carries TEMPORARY, so the grant is idempotent and kept only
// to match the card text). Mode (b) is a battle summon (summonHulls +
// declareForcedBattle — the Orbit lives only in ActiveBattle.summons and
// evaporates on report approval regardless of HP, never touching
// zone.cards). Neither passes `activatesZone` — a forced battle is not a
// zone activation, and a spawn never was one either.
//
// The mode chosen at hop 1 is stashed in hop 2's pendingEffect.data and read
// back from payload.pending.data — never inferred from
// payload.resolution.targetInstanceId / .zoneId, which are client-supplied
// and unvalidated (unlike resolution.choiceId, which `choice()` already
// checks against pending.options before resolve() ever sees it). Inferring
// the mode from anything the client sent would let a player choose mode (a)
// and then answer hop 2's dialog as though it were mode (b).
const ORBIT_FLANK = 'orbitFlankEffect'
const ORBIT_FLANK_SPAWN = 'spawn'
const ORBIT_FLANK_BATTLE = 'battle'

registerEffect(ORBIT_FLANK, choice({
  effect: ORBIT_FLANK,
  prompt: 'Choose one: spawn a friendly orbit into any zone, or send an orbit to fight an enemy vehicle alone',
  options: () => [
    { id: ORBIT_FLANK_SPAWN, label: 'Spawn a friendly orbit into any zone' },
    { id: ORBIT_FLANK_BATTLE, label: 'Choose an enemy vehicle to fight an orbit alone' },
  ],
  resolve: (payload, choiceId) => {
    const { game, actor, ctx, card } = payload
    const mode = payload.pending?.data?.mode

    if (mode === ORBIT_FLANK_SPAWN) {
      // Hop 2 of mode (a): choiceId is the chosen zone's id (the string form
      // of ZoneState.id minted into the options below).
      if (typeof choiceId !== 'string') return false
      return spawnVehicles({
        cardName: 'Orbit', count: 1, zones: 'target', keywords: [KEYWORDS.TEMPORARY],
      })({ ...payload, targetZoneId: Number(choiceId) })
    }

    if (mode === ORBIT_FLANK_BATTLE) {
      // Hop 2 of mode (b): choiceId is the chosen enemy vehicle's instanceId.
      if (typeof choiceId !== 'string') return false
      const found = findVehicle(game.state, choiceId)
      if (!found || found.side !== otherSide(actor)) return false
      const summons = summonHulls(game, ctx, 'Orbit', 1)
      if (!summons) return false
      return declareForcedBattle(game, ctx, {
        zoneId: found.zone.id,
        aggressor: actor,
        attackerIds: summons.map((s) => s.instanceId),
        defenderIds: [choiceId],
        summons,
        cause: card.name,
      })
    }

    // Hop 1: choiceId is the mode just picked ('spawn' or 'battle').
    if (choiceId === ORBIT_FLANK_SPAWN) {
      game.state.pendingEffect = {
        effect: ORBIT_FLANK, side: actor, card, kind: 'choice',
        prompt: 'Choose a zone for the Orbit',
        options: game.state.zones.map((z) => ({ id: String(z.id), label: `Zone ${z.id} (${z.biome})` })),
        data: { mode: ORBIT_FLANK_SPAWN },
      }
      game.state.log.push(`${card.name} is waiting on a choice`)
      return true
    }
    if (choiceId === ORBIT_FLANK_BATTLE) {
      // Empty options do not suspend (primitives.ts choice() rule 2 — hand-
      // rolled here since this is hop 2, not choice()'s own first entry): no
      // enemy vehicle anywhere means mode (b) simply fizzles.
      const targets = enemyVehicleOptions(game, actor, null)
      if (targets.length === 0) {
        game.state.log.push(`${card.name} finds no enemy vehicle to challenge`)
        return true
      }
      game.state.pendingEffect = {
        effect: ORBIT_FLANK, side: actor, card, kind: 'choice',
        prompt: 'Choose an enemy vehicle for the Orbit to fight',
        options: targets,
        data: { mode: ORBIT_FLANK_BATTLE },
      }
      game.state.log.push(`${card.name} is waiting on a choice`)
      return true
    }
    return false // unreachable — choice() already validated choiceId against pending.options
  },
}), { needsCatalog: true })

const ECLIPSE = 'eclipseEffect'

const eclipseTargetable = (e: ZoneCardEntry) => !e.keywords.includes(KEYWORDS.STEALTHY)

// "Once per turn this vehicle may target one non-stealthy enemy vehicle in
// its zone to have a 1v1 battle. If you do so, you may not declare a fleet
// battle in this zone this turn." Ships with onActivate already seeded but
// no activateCpCost — ACTIVATE_VEHICLE and BoardZone's button both require
// BOTH keys, so the ability is unreachable without it (spec §6). Eclipse's
// text never mentions CP, unlike Braveheart's "pay 1cp", hence 0 rather than
// 1 — and 0 must be authored explicitly and read via a typeof check, not a
// truthiness one, or the ability is unreachable all over again
// (shared/engine/activate.ts's activateCpCostOf already does this right;
// this file only has to not break it).
//
// DP1 + DP4 (choice, over enemyVehicleOptions scoped to the hull's own zone,
// excluding Stealthy) + DP3 (declareForcedBattle, activatesZone: true).
// Eclipse is the SOLE card that stamps lastActivatedTurn from a forced
// battle (spec §4.3 ruling: "a forced battle is not a zone activation"
// everywhere else — see Braveheart, shared/effects/ssEffects.ts, for the
// ordinary case). The stamp only PREVENTS a later fleet battle in this zone
// this turn; Eclipse's own text says nothing about being blocked by an
// EARLIER one, so no lastActivatedTurn precondition is added here — only
// ACTIVATE_VEHICLE's own activatedOnTurn (this hull, once per turn) gates
// activation at all.
//
// Same no-data-stash reasoning as Braveheart: payload.card is the
// activating hull on both entries, so its zone is re-derived via
// findVehicle(card.instanceId) rather than trusted from the RESOLVE_PENDING_EFFECT
// action. resolve() re-runs the identical enemyVehicleOptions() call (same
// zone, same Stealthy filter) to re-confirm choiceId before declaring the
// battle.
function eclipseZone(game: EngineGame, actor: Side, card: { instanceId: string }) {
  const found = findVehicle(game.state, card.instanceId)
  return found && found.side === actor ? found : null
}

registerEffect(ECLIPSE, choice({
  effect: ECLIPSE,
  prompt: 'Choose a non-Stealthy enemy vehicle for Eclipse to fight',
  options: ({ game, actor, card }) => {
    const self = eclipseZone(game, actor, card)
    return self ? enemyVehicleOptions(game, actor, self.zone.id, eclipseTargetable) : []
  },
  resolve: (payload, choiceId) => {
    const { game, actor, card, ctx } = payload
    if (choiceId === null) return false // no non-Stealthy enemy vehicle in the zone
    const self = eclipseZone(game, actor, card)
    if (!self) return false
    const stillLegal = enemyVehicleOptions(game, actor, self.zone.id, eclipseTargetable).some((o) => o.id === choiceId)
    if (!stillLegal) return false
    return declareForcedBattle(game, ctx, {
      zoneId: self.zone.id,
      aggressor: actor,
      attackerIds: [card.instanceId],
      defenderIds: [choiceId],
      cause: card.name,
      activatesZone: true,
    })
  },
}))

const TERAWATT = 'terawattJoin'
// The zone matters to the defender: they may hold vehicles in more than one,
// and the dialog shows the prompt alone.
const TERAWATT_PROMPT = 'A friendly vehicle is about to fight alone — send Terawatt in?'

// "Whenever a friendly vehicle would be made to fight in battle alone due to
// enemy card effect, you may add this vehicle to the combat."
//
// Wave 4's only BYSTANDER effect (spec §4.3, DP2 departure 2): it reacts to a
// battle it is not in, which the participant loop cannot reach. The
// { battleBystander: true } flag is what puts it in that pass — and what keeps
// every other DP2 card out of it, so none of them needs an isParticipant guard
// it could silently forget.
//
// Three conditions, each from a different part of the text:
//   "due to enemy card effect" → battle.forced. An ordinary fleet attack is
//     not that, however lonely the defender ends up. Defence in depth only:
//     dispatchBattleLock runs the bystander pass exclusively for a forced
//     battle, so no test can kill this guard — it exists so a future change to
//     that dispatcher cannot silently widen the card.
//   "alone"                    → the defending side has exactly one
//     participant. Terawatt itself is excluded: if it IS that participant, the
//     bystander pass skips it as a combatant and the participant pass hands it
//     isParticipant true, which the guard below rejects.
//   the same zone              → ruled in spec §7.3, matching Braveheart's "in
//     the same zone" and Gang Up's "from the same zone". The bystander pass
//     already scopes to the battle's zone; resolve re-derives it anyway,
//     because by then the board may have moved.
//
// This is one of the two effects that can leave state.pendingEffect set while
// state.activeBattle still stands (decision 19). That is safe and tested —
// shared/engine/battleFreeze.test.ts — and the choice is owed by the DEFENDER,
// who is off-turn, which is exactly why RESOLVE_PENDING_EFFECT is an
// OFF_TURN_ACTION.
const terawattChoice = choice({
  effect: TERAWATT,
  prompt: TERAWATT_PROMPT,
  options: ({ card }) => [{ id: 'join', label: `Send ${card.name} in` }],
  // payload.card IS the Terawatt hull (the dispatch hands the effect its own
  // zone entry, and pendingEffect carries it verbatim across the suspension),
  // so only the zone needs stashing. Never read back off payload.resolution,
  // which is client-supplied and unvalidated.
  data: ({ battle }) => ({ zoneId: battle?.zoneId }),
  resolve: ({ game, actor, card, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const battle = game.state.activeBattle
    // Re-checked server-side rather than trusted from the first entry.
    // While pendingEffect stands, applyAction admits only RESOLVE/CONCEDE/
    // ABANDON, so today nothing CAN move Terawatt or change the battle between
    // the offer and the answer — these are a guard against that freeze ever
    // being relaxed, not against a race that exists now. "Alone" is the one
    // that is genuinely reachable: a second bystander joining in the same lock
    // would mean the vehicle is no longer fighting alone by the time this runs.
    if (!battle || battle.zoneId !== zoneId || battle.defenderIds.length !== 1) return false
    const self = findVehicle(game.state, card.instanceId)
    if (!self || self.side !== actor || self.zone.id !== zoneId) return false
    // No `entry` argument: Terawatt is already on the board, so it joins as an
    // ordinary combatant rather than as a battle summon that would evaporate.
    if (!joinBattle(game, actor, card.instanceId)) return false
    game.state.log.push(`${card.name} joins the battle in zone ${zoneId}`)
    return true
  },
})

registerEffect(TERAWATT, (payload) => {
  if (payload.resolution !== undefined) return terawattChoice(payload)
  const { game, battle } = payload
  if (!battle || battle.phase !== 'lock' || !battle.forced) return true
  // isDefender is defence in depth alongside  above: the bystander
  // pass only ever scans the DEFENDING side of the zone, so no reachable
  // dispatch delivers false here. isParticipant is the live half — the
  // participant pass reaches this effect when Terawatt is itself in the fight.
  if (battle.isParticipant || !battle.isDefender) return true
  const active = game.state.activeBattle
  if (!active || active.defenderIds.length !== 1) return true
  return terawattChoice(payload)
}, { battleBystander: true })

// ---------------------------------------------------------------------------
// 2026-09-21 redesign (docs/superpowers/specs/2026-09-21-lh-faction-redesign-design.md).
// Every id below is NEW: the pre-redesign ids above stay registered for the
// frozen snapshots of games dealt before the deploy (spec §7) and are never
// reused (the Kraken/Paddlegun rule).
// ---------------------------------------------------------------------------

const isLh = (e: { faction: string }): boolean => e.faction === FACTIONS.LH

// Byte — "Discharge 1: draw a card." The engine has already checked and spent
// the pip (ACTIVATE_VEHICLE, spec §3.2); this is the draw and nothing else.
registerEffect('byteDraw', grant({ draw: 1 }))

// 2026-09-22 LH draw amendment (docs/superpowers/specs/2026-09-22-lh-draw-design.md).
// New ids again: Byte snapshots dealt before the deploy name no onPlayEffect,
// so they keep entering empty.

// "When played, this gains N charge." PLAY_CARD_TO_ZONE places the hull before
// on-play effects fire, so it is on the board to charge; its own chargeMax
// caps the gain. Byte, Ampere and the Watt each call it under their own id.
function gainOwnCharge({ game, actor, card }: EffectPayload, amount: number): void {
  const found = findVehicle(game.state, card.instanceId)
  if (!found || found.side !== actor) return
  const gained = addCharge(found.entry as ZoneCardEntry, amount)
  if (gained > 0) game.state.log.push(`${card.name} gains ${gained} charge`)
}

// Byte — "When played, this gains 1 charge."
registerEffect('byteChargeOnPlay', (payload) => {
  gainOwnCharge(payload, BYTE_PLAY_CHARGE)
  return true
})

// Faraday — "When played, draw a card." Mandrel's shape.
registerEffect('faradayOnPlay', grant({ draw: 1 }))

// Data Burst — "Discharge 2 from a friendly LH vehicle: draw 2 cards." The
// engine has already validated the host and spent its pips (dischargeFrom,
// PLAY_CARD_TARGETING_CARD_ON_FIELD); this is the draw and nothing else.
registerEffect('dataBurstEffect', grant({ draw: DATA_BURST_DRAW }))

// Watt — "When played, this gains 1 charge and a friendly Luxon spawns in this
// zone. That Luxon has Decoy and is not Temporary." (2026-09-22 hovercraft
// amendment §3.) Spawning is not playing: no payment, no blind-placement check,
// no on-play. The Decoy is a recorded grant and Temporary a recorded revoke —
// Extended Sortie's path, so the turn-start cull skips it. The Luxon is a
// TOKEN: stamped summonOnly, which discardCard refuses, so a dead one is gone
// instead of filing a free Luxon into the deck. No room in the lane → no
// Luxon, the room rule a card's printed extra copies follow. A catalog without
// Luxon is a data bug and fails the play (spawnVehicles' contract), checked
// before anything moves.
const WATT_ESCORT = 'Luxon'
registerEffect('wattOnPlay', (payload) => {
  const { game, actor, card, ctx } = payload
  const escortCard = catalogCard(ctx, WATT_ESCORT)
  if (!escortCard || !poolEligible(escortCard)) return false
  const self = findVehicle(game.state, card.instanceId)
  if (!self || self.side !== actor) return true
  gainOwnCharge(payload, WATT_PLAY_CHARGE)
  const zoneId = self.zone.id
  if (self.zone.cards[actor].length >= zoneCapFor(game.state, actor, zoneId)) {
    game.state.log.push(`${card.name}: no room in zone ${zoneId} for its Luxon`)
    return true
  }
  const escort = spawnInto(game, ctx, actor, zoneId, escortCard)
  if (!escort) return false
  grantKeywordsTo(escort, [KEYWORDS.DECOY])
  revokeKeywordsFrom(escort, [KEYWORDS.TEMPORARY])
  escort.meta = { ...escort.meta, summonOnly: true }
  game.state.log.push(`${card.name} launches a Luxon in zone ${zoneId} — it has Decoy and stays`)
  return true
}, { needsCatalog: true })

// Watt — "Discharge 1: draw a card." Byte's draw under the Watt's own id: no
// two cards share a registry name, however small the implementation
// (docs/claude/card-effects.md, rule 2).
registerEffect('wattDraw', grant({ draw: 1 }))

// 2026-09-23, the draw amendment's second round: two solid hulls draw as they
// land, and Feedback Loop turns a lane's discharges into cards.
// Kilowatt and Megawatt — "When played, draw a card." Snapshots dealt before
// the deploy name no onPlayEffect and stay vanilla.
registerEffect('kilowattOnPlay', grant({ draw: 1 }))
registerEffect('megawattOnPlay', grant({ draw: 1 }))

// Feedback Loop — "Choose a zone. This turn, whenever a friendly LH vehicle in
// that zone discharges, draw a card." Claims an Ambush-shaped rider that
// expires at this player's END_TURN; the draw itself is a plain rule the two
// discharge paths read off data.dischargeDraw (gameEngine.ts drawOnDischarge).
// A second copy on a zone it already runs in is refused rather than spent on
// a no-op, since it does not stack.
const FEEDBACK_LOOP = 'feedbackLoopEffect'
registerEffect(FEEDBACK_LOOP, ({ game, actor, card, targetZoneId, battle }) => {
  // A standing rider is re-dispatched by battle lock, bombardment and
  // interception in its zone (battleTriggers.ts); none of those is a discharge.
  if (battle) return true
  if (typeof targetZoneId !== 'number' || !zoneById(game.state, targetZoneId)) return false
  const running = game.state.zoneEffects.some(
    (e) => e.effect === FEEDBACK_LOOP && e.zoneId === targetZoneId && e.side === actor,
  )
  if (running) return false
  game.state.zoneEffects.push({
    effect: FEEDBACK_LOOP, zoneId: targetZoneId, side: actor, cardName: card.name,
    setOnTurn: game.turnNumber, expiresOnTurn: game.turnNumber,
    data: { dischargeDraw: true },
  })
  game.state.log.push(
    `Player ${actor.toUpperCase()} runs ${card.name} in zone ${targetZoneId} — every LH discharge there this turn draws a card`,
  )
  return true
})

// Volta — "When played, a friendly LH vehicle in this zone gains 1 charge."
// The player picks (R-3): which timer to accelerate is the whole decision.
// The prompt excludes what this play just placed (Volta itself) and anything
// already full; no candidate → a log line, never a refusal.
const VOLTA = 'voltaJumpStart'
registerEffect(VOLTA, choice({
  effect: VOLTA,
  prompt: 'Volta jump-starts a friendly LH vehicle in this zone — choose which gains 1 charge',
  options: ({ game, actor, targetZoneId, placedInstanceIds }) => (
    typeof targetZoneId === 'number'
      ? friendlyVehicleOptions(game, actor, targetZoneId, (e) =>
          isLh(e) && hasChargeRoom(e) && !(placedInstanceIds ?? []).includes(e.instanceId))
      : []
  ),
  resolve: ({ game, actor, card }, choiceId) => {
    if (choiceId === null) {
      game.state.log.push(`${card.name}: nothing in this zone can take a charge`)
      return true
    }
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== actor) return false
    const gained = addCharge(found.entry as ZoneCardEntry, VOLTA_JUMP_START_CHARGE)
    game.state.log.push(`${card.name} jump-starts ${found.entry.name} (+${gained} charge)`)
    return true
  },
}))

// The three beams (spec §3.8): effect damage in the hull's own lane, Blocker
// ignored, a fallen base a no-op. dealBaseDamage owns the rule; this only
// finds the lane and, for the pre-2026-09-22 Umbra id, surfaces the sub
// afterwards (R-8, since overturned).
function beam(materials: number, surfaces: boolean): EffectFn {
  return ({ game, actor, card }) => {
    const found = findVehicle(game.state, card.instanceId)
    if (!found || found.side !== actor) return false
    if (!dealBaseDamage(game, actor, found.zone.id, materials, card.name)) return false
    if (surfaces) {
      revokeKeywordsFrom(found.entry, [KEYWORDS.STEALTHY])
      game.state.log.push(`${card.name} surfaces — it is no longer Stealthy`)
    }
    return true
  }
}
registerEffect('umbraSalvo', beam(UMBRA_SALVO_DAMAGE, true))

// 2026-09-22 hovercraft amendment §3: Umbra stays Stealthy after firing (R-8
// overturned). A NEW id: dealt Umbras keep 'umbraSalvo' and still surface.
registerEffect('umbraBeam', beam(UMBRA_SALVO_DAMAGE, false))
registerEffect('superradianceBeam', beam(SUPERRADIANCE_BEAM_DAMAGE, false))
registerEffect('impedanceBeam', beam(IMPEDANCE_BEAM_DAMAGE, false))

// Ampere — "When played, stun target enemy vehicle in this zone." On play
// only (R-10); enemyVehicleOptions applies Decoy in a mirror. No enemy in the
// lane: the play resolves with no stun and no refund. One factory for both
// ids, because a pending choice re-dispatches by the id it was offered under.
function ampereStunChoice(effect: string): EffectFn {
  return choice({
    effect,
    prompt: "Ampere's EMP salvo — choose an enemy vehicle in this zone to stun",
    options: ({ game, actor, targetZoneId }) => (
      typeof targetZoneId === 'number' ? enemyVehicleOptions(game, actor, targetZoneId) : []
    ),
    resolve: ({ game, actor, card }, choiceId) => {
      if (choiceId === null) {
        game.state.log.push(`${card.name}: no enemy vehicle in this zone to stun`)
        return true
      }
      const found = findVehicle(game.state, choiceId)
      if (!found || found.side !== otherSide(actor)) return false
      stunHull(game, found.entry as ZoneCardEntry)
      return true
    },
  })
}
registerEffect('ampereStun', ampereStunChoice('ampereStun'))

// 2026-09-22 hovercraft amendment §3 (docs/superpowers/specs/2026-09-22-lh-hovercraft-design.md):
// "When played, this gains 2 charge and stuns target enemy vehicle in this
// zone." A NEW id: dealt Amperes keep 'ampereStun' and enter empty. The charge
// lands on the FIRST entry only, before the stun is offered, so a lane with no
// enemy still charges and the pick's re-entry cannot charge twice.
const AMPERE_CHARGED = 'ampereChargedStun'
const ampereChargedStun = ampereStunChoice(AMPERE_CHARGED)
registerEffect(AMPERE_CHARGED, (payload) => {
  if (payload.resolution === undefined) gainOwnCharge(payload, AMPERE_PLAY_CHARGE)
  return ampereChargedStun(payload)
})

// A charged 1v1 (spec §3.9): the old Eclipse's shape with a new id, the charge
// as its cost, and NO zone activation spent — "a forced battle is not a zone
// activation" holds for these as for every other forced battle. "Non-Stealthy"
// is read at declaration, so a hull Ampere stunned this turn qualifies.
// `surfaces` is Cathode's (R-18; dealt snapshots only since 2026-09-23):
// Stealthy comes off the moment the duel is declared, and a refused
// declaration rolls the whole clone back.
function duel(id: string, prompt: string, targetable: (e: ZoneCardEntry) => boolean, surfaces: boolean): EffectFn {
  const canTarget = (game: EngineGame, e: ZoneCardEntry) =>
    !(e.keywords.includes(KEYWORDS.STEALTHY) && !isStunned(e, game.turnNumber)) && targetable(e)
  return choice({
    effect: id,
    prompt,
    options: ({ game, actor, card }) => {
      const self = findVehicle(game.state, card.instanceId)
      return self ? enemyVehicleOptions(game, actor, self.zone.id, (e) => canTarget(game, e)) : []
    },
    resolve: ({ game, actor, card, ctx }, choiceId) => {
      if (choiceId === null) return false
      const self = findVehicle(game.state, card.instanceId)
      if (!self || self.side !== actor) return false
      const stillLegal = enemyVehicleOptions(game, actor, self.zone.id, (e) => canTarget(game, e)).some((o) => o.id === choiceId)
      if (!stillLegal) return false
      if (surfaces) {
        revokeKeywordsFrom(self.entry, [KEYWORDS.STEALTHY])
        game.state.log.push(`${card.name} surfaces — it is no longer Stealthy`)
      }
      return declareForcedBattle(game, ctx, {
        zoneId: self.zone.id, aggressor: actor,
        attackerIds: [card.instanceId], defenderIds: [choiceId],
        cause: card.name, activatesZone: false,
      })
    },
  })
}
registerEffect('eclipseDuel', duel('eclipseDuel', 'Choose a non-Stealthy enemy vehicle for Eclipse to fight', () => true, false))

// Cathode — "Discharge 2: this vehicle fights a 1v1 against target enemy ship
// or submarine in this zone, then this surfaces." Same duel() shape as
// Eclipse, restricted to ship/sub targets and with surfaces: true (R-18).
registerEffect('cathodeDuel', duel(
  'cathodeDuel',
  'Choose an enemy ship or submarine for Cathode to fight — it will surface',
  (e) => isShipClass(e.vehicleType) || e.vehicleType === VEHICLE_TYPES.SUB,
  true,
))

// 2026-09-23 (docs/superpowers/specs/2026-09-23-lh-drain-discount-design.md §6):
// Cathode — "Overheat: after each battle it fights, it is stunned until the
// end of the next turn." The existing stun, stamped from the battle's own turn:
// after an attack it sits out the enemy's turn (held still in FtD — subs are
// held types), after a defence its owner's next one. Resolve only, survivors
// only, whatever the outcome; lock does nothing. A NEW id: dealt Cathodes keep
// cathodeDuel and never overheat.
registerEffect('cathodeOverheat', ({ game, actor, card, battle }) => {
  if (battle?.phase !== 'resolve' || !battle.survived) return true
  const self = findVehicle(game.state, card.instanceId)
  if (!self || self.side !== actor) return true
  stunHull(game, self.entry as ZoneCardEntry, `${card.name} overheats — stunned until the end of the next turn`)
  return true
})

// Penumbra — "Discharge 3: stun every enemy vehicle in this zone." Every hull,
// already-stunned ones included (they get the same expiry). An empty lane is
// the player's own choice of timing: the charge is spent regardless.
registerEffect('penumbraPulse', ({ game, actor, card }) => {
  const found = findVehicle(game.state, card.instanceId)
  if (!found || found.side !== actor) return false
  const enemies = found.zone.cards[otherSide(actor)] as ZoneCardEntry[]
  for (const e of enemies) stunHull(game, e)
  game.state.log.push(`${card.name} pulses — ${enemies.length} enemy vehicle(s) in zone ${found.zone.id} stunned`)
  return true
})

// Terawatt — "Discharge 2: another friendly LH vehicle in this zone gains 2
// charge." No candidate with room → refuse, so the activation rolls back and
// the pips stay (the engine spent them before the effect ran).
const TERAWATT_TRANSFER = 'terawattTransfer'
registerEffect(TERAWATT_TRANSFER, choice({
  effect: TERAWATT_TRANSFER,
  prompt: 'Terawatt discharges into a friendly LH vehicle in this zone — choose which gains 2 charge',
  options: ({ game, actor, card }) => {
    const self = findVehicle(game.state, card.instanceId)
    return self
      ? friendlyVehicleOptions(game, actor, self.zone.id, (e) => isLh(e) && e.instanceId !== card.instanceId && hasChargeRoom(e))
      : []
  },
  resolve: ({ game, actor, card }, choiceId) => {
    if (choiceId === null) return false
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== actor) return false
    const gained = addCharge(found.entry as ZoneCardEntry, TERAWATT_TRANSFER_CHARGE)
    game.state.log.push(`${card.name} discharges into ${found.entry.name} (+${gained} charge)`)
    return true
  },
}))

// The three "Discharge 2 from a friendly LH vehicle" abilities (spec §3.2,
// R-24). PLAY_CARD_TARGETING_CARD_ON_FIELD has validated the host and spent
// the pips; each effect makes its second pick in the HOST'S lane through
// `choice`. An empty option list resolves with null → false → the play is
// refused and the clone rolled back, so nothing was spent (R-24's "greyed in
// hand" is the engine refusing; the UI shows the reason).
function hostLane(game: EngineGame, targetInstanceId: string | undefined) {
  return typeof targetInstanceId === 'string' ? findVehicle(game.state, targetInstanceId) : null
}

const EMP_SALVO = 'empSalvoEffect'
registerEffect(EMP_SALVO, choice({
  effect: EMP_SALVO,
  prompt: 'EMP Salvo — choose an enemy vehicle in that zone to stun',
  options: ({ game, actor, targetInstanceId }) => {
    const host = hostLane(game, targetInstanceId)
    return host ? enemyVehicleOptions(game, actor, host.zone.id) : []
  },
  resolve: ({ game, actor }, choiceId) => {
    if (choiceId === null) return false
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== otherSide(actor)) return false
    stunHull(game, found.entry as ZoneCardEntry)
    return true
  },
}))

// Overcharge — "Target friendly LH vehicle gains 2 charge." A fresh hull is a
// legal target (R-25); a full one, or a non-LH one, is not.
registerEffect('overchargeEffect', ({ game, actor, card, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== actor) return false
  const entry = found.entry as ZoneCardEntry
  if (!isLh(entry) || !hasChargeRoom(entry)) return false
  const gained = addCharge(entry, OVERCHARGE_CHARGE)
  game.state.log.push(`${card.name}: ${entry.name} gains ${gained} charge`)
  return true
})

const AFTERBURNER = 'afterburnerEffect'
registerEffect(AFTERBURNER, choice({
  effect: AFTERBURNER,
  prompt: 'Afterburner — choose a friendly LH vehicle played this turn in that zone',
  options: ({ game, actor, targetInstanceId }) => {
    const host = hostLane(game, targetInstanceId)
    return host
      ? friendlyVehicleOptions(game, actor, host.zone.id, (e) => isLh(e) && e.playedOnTurn === game.turnNumber)
      : []
  },
  resolve: ({ game, actor, card }, choiceId) => {
    if (choiceId === null) return false
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== actor) return false
    ;(found.entry as ZoneCardEntry).swiftOnTurn = game.turnNumber
    game.state.log.push(`${card.name}: ${found.entry.name} may attack the base this turn`)
    return true
  },
}))

const EXTENDED_SORTIE = 'extendedSortieEffect'
registerEffect(EXTENDED_SORTIE, choice({
  effect: EXTENDED_SORTIE,
  prompt: 'Extended Sortie — choose a friendly LH plane in that zone to keep',
  options: ({ game, actor, targetInstanceId }) => {
    const host = hostLane(game, targetInstanceId)
    return host
      ? friendlyVehicleOptions(game, actor, host.zone.id, (e) =>
          isLh(e) && e.vehicleType === VEHICLE_TYPES.PLANE && e.keywords.includes(KEYWORDS.TEMPORARY))
      : []
  },
  resolve: ({ game, actor, card }, choiceId) => {
    if (choiceId === null) return false
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== actor) return false
    revokeKeywordsFrom(found.entry, [KEYWORDS.TEMPORARY])
    game.state.log.push(`${card.name}: ${found.entry.name} stays on station — it is no longer Temporary`)
    return true
  },
}))
