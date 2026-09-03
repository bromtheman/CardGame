import {
  catalogCard, choice, enemyVehicleOptions, friendlyVehicleOptions, grant, mintHull, spawnVehicles,
  summonHulls,
} from './primitives.ts'
import { declareForcedBattle, joinBattle } from '../engine/battleDeclare.ts'
import { checkVictory, copyMeta, findVehicle, otherSide, zoneById } from '../engine/gameEngine.ts'
import { FACTORY_ESCORT_KEY, fireDeathEffect, returnToHand, sacrificeEntry } from '../engine/battleTriggers.ts'
import { effectiveMaterialCostOf } from '../engine/placement.ts'
import { BASE_DAMAGE_DIVISOR, FACTIONS, KEYWORDS, VENGEFUL_BASE_DAMAGE } from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
import type { EffectFn, EffectPayload } from './registry.ts'
import { registerEffect } from './registry.ts'

// TG built-in card effects (wave 7).
//
// The faction arrives as one file of 26 cards rather than as a backlog, so
// unlike every earlier faction module this one was written against seeded rows
// that already existed — which is why each registration below deletes a
// KNOWN_GAPS entry rather than adding one.

// "When this vehicle is destroyed, draw a card." basherOnDeath verbatim.
//
// ✅ Jealousy prints BLOCKER and nothing else. A built-in must never carry both
// SCRAPPY and an onDeathEffect (docs/claude/card-effects.md, checklist item
// 10): a Scrappy hull auto-repairs in the 80–89.999% band with no prompt, so
// the trigger would be silently unreachable.
registerEffect('jealousyOnDeath', grant({ draw: 1 }))

// "When this vehicle is played, spawn a friendly horror into each zone."
// sapphireScreenEffect's shape, with no keyword grant — Horror's printed
// keywords are the whole of what lands.
//
// ⚠ Fear names Horror rather than a vanilla hull for a reason, and the
// consequence is worth stating rather than discovering in a battle report:
// SPAWNING IS NOT PLAYING (spec §7.4), and that rule skips `onPlayEffect` and
// NOTHING ELSE. Horror's own `onBattleEffect` is read off each spawned entry's
// printed meta by DP2, so all three Horrors fire their own copy rule. This is
// wave 6's Nothung/Sacrilego ruling again.
//
// ⚠ Spawns also bypass placement legality, so a Horror (a ship) lands in the
// land zone that a ship could never be PLAYED into.
//
// Balance note, recorded rather than fixed: the 2026-09-02 pass cut Fear to
// 500k, so its own upkeep is 75k/turn (UPKEEP_RATE 0.15) and it lands as early
// as turn 7, the first turn a 500k card can be played at all (spec §7.3, U-8).
// The three Horrors it spawns add nothing to that upkeep — Horror dropped
// UPKEEP_REQUIRED in the same pass — but each is its own self-replicating
// engine per horrorBattle's own balance note below.
registerEffect('fearOnPlay', spawnVehicles({
  cardName: 'Horror',
  count: 1,
  zones: 'all',
}), { needsCatalog: true })

// "Whenever this vehicle participates in a fleet battle, spawn a temporary
// Mirth swarm to fight on your side in the battlefield."
//
// A BATTLE SUMMON, not a board spawn (spec §4.4): summonHulls + joinBattle,
// never zone.cards, so it evaporates on report approval regardless of HP.
// harbringerBattle's shape, minus the choice — Obelisk's text offers nothing.
//
// ⚠ The lock guard is load-bearing, not defensive: DP2 fires the SAME
// onBattleEffect key at resolve, by which point activeBattle is already null.
// Harbringer is the worked example.
//
// "Participates in a fleet battle" reads to offensive AND defensive battles,
// and — per §7.3's Catshark ruling — to forced ones, so there is deliberately
// no isDefender guard. Obelisk is a participant rather than a rider, so it
// needs no zoneEffects entry and no bystander flag: DP2's lock pass already
// reaches participants on both sides.
//
// ✅ Mirth Swarm already prints TEMPORARY, so the word in the card text is
// decorative and no keyword grant is passed.
//
// ⚠ Obelisk is STEALTHY, so an ATTACK_ENEMY_FLEET naming it raises the
// response window instead of locking — and DP2's whole dispatch then happens
// on RESPOND_TO_ATTACK. Live scenarios must go through that action.
registerEffect('obeliskBattle', ({ game, actor, ctx, card, battle }) => {
  if (!battle || battle.phase !== 'lock' || !battle.isParticipant) return true
  const summons = summonHulls(game, ctx, 'Mirth Swarm', 1)
  // A missing catalog card is a data bug, not an empty pool — but at lock the
  // battle is already declared and cannot be rolled back, so this reports
  // failure and DP2's dispatcher logs it rather than throwing.
  if (!summons) return false
  const [swarm] = summons
  if (!joinBattle(game, actor, swarm.instanceId, swarm)) return false
  game.state.log.push(`${card.name} calls in a ${swarm.name}`)
  return true
}, { needsCatalog: true })

// "When this vehicle is played, you may target any enemy vehicle on the board
// and give it INOFFENSIVE keyword."
//
// ⚠ NOT a grantKeywords composition, and composing it would fail SILENTLY:
// grantKeywords reads `payload.targetInstanceId`, which RESOLVE_PENDING_EFFECT
// never sets. The card would suspend correctly, resolve, and do nothing.
//
// Eclipse's shape instead — the target arrives as `choiceId`, which `choice()`
// has already validated against `pending.options` before resolve runs, and
// which is therefore the ONLY channel used. `resolution.targetInstanceId` is
// client-supplied and unvalidated and is never read.
//
// No `data` stash is needed, unlike Air Strafe's: nothing about this card
// depends on state the board cannot hand back. resolve re-runs the identical
// enemyVehicleOptions() call to re-confirm the choice, in case the hull left
// while the dialog sat open.
//
// `zoneId: null` scopes the options to the WHOLE board — the card says "any
// enemy vehicle on the board", not "in this zone". On-field vehicles are
// already public, so pendingEffect.options leaks nothing (spec §4.2,
// departure 4).
const HYSTERIA = 'hysteriaOnPlay'
registerEffect(HYSTERIA, choice({
  effect: HYSTERIA,
  prompt: 'Choose an enemy vehicle to make Inoffensive',
  options: ({ game, actor }) => enemyVehicleOptions(game, actor, null),
  resolve: ({ game, actor }, choiceId) => {
    // "You may": choice() resolves straight through with null when the board
    // holds no enemy vehicle, and that is a success, not a fizzle.
    if (choiceId === null) return true
    // Re-checked against the board rather than trusted from the first entry.
    //
    // ⚠ The side half is UNREACHABLE today and a surviving mutation proved it,
    // so do not go looking for the test that pins it — there cannot be one.
    // While pendingEffect stands, applyAction admits only RESOLVE/CONCEDE/
    // ABANDON, and USE_HERO_POWER is excluded, so nothing can trade the target
    // to the other side (Boarding Party) between the offer and the answer. It
    // is a guard against that freeze ever being relaxed, exactly as Terawatt's
    // own re-checks are. The `!found` half IS live: the hull can be gone.
    //
    // This replaced a full enemyVehicleOptions() re-scan, which was strictly
    // redundant — findVehicle already covers "the hull left the board", which
    // is why the mutation survived — and hid what the check was really for.
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== otherSide(actor)) return false
    // Idempotent, matching grantKeywords: a keyword already carried is not
    // duplicated.
    if (!found.entry.keywords.includes(KEYWORDS.INOFFENSIVE)) {
      found.entry.keywords = [...found.entry.keywords, KEYWORDS.INOFFENSIVE]
    }
    game.state.log.push(`${found.entry.name} is made Inoffensive`)
    return true
  },
}))

// "When played, grant an enemy vehicle FRAGILE." Printed identically on TG
// Spite and TG Agony (2026-09-02 spec §6.4), so the behaviour is one factory —
// and TWO registrations, under two names.
//
// ⚠ `effect` is a PARAMETER rather than a constant closed over inside, and
// that is the whole safety of sharing the shape. `choice` never sees the name
// registerEffect files it under, so each registration must hand in its own;
// passing the other card's name compiles, passes any test that calls the
// effect directly, and fails only when a live player answers the dialog.
// Reusing one id for both is the Kraken/Paddlegun collision (spec R-6): the
// name is frozen into dealt game state, the implementation is redeployed for
// every game at once.
//
// ⚠ NOT a grantKeywords composition, and composing it would fail SILENTLY —
// grantKeywords reads payload.targetInstanceId, which PLAY_CARD_TO_ZONE never
// sets for an onPlayEffect and RESOLVE_PENDING_EFFECT never sets at all. This
// is hysteriaOnPlay's shape, and its comment is the long version.
//
// `zoneId: null` scopes the offer to the WHOLE board: the text says "an enemy
// vehicle", with no zone qualifier. On-field vehicles are already public, so
// pendingEffect.options leaks nothing.
function fragileGrant(effect: string, prompt: string): EffectFn {
  return choice({
    effect,
    prompt,
    options: ({ game, actor }) => enemyVehicleOptions(game, actor, null),
    resolve: ({ game, actor }, choiceId) => {
      // No enemy vehicle anywhere: choice() resolves straight through with
      // null, and that is a success — the hull still deploys.
      if (choiceId === null) return true
      // Re-checked against the board rather than trusted from the first entry:
      // the hull can be gone by the time the dialog is answered.
      const found = findVehicle(game.state, choiceId)
      if (!found || found.side !== otherSide(actor)) return false
      // Idempotent, matching grantKeywords: a keyword already carried is not
      // duplicated.
      if (!found.entry.keywords.includes(KEYWORDS.FRAGILE)) {
        found.entry.keywords = [...found.entry.keywords, KEYWORDS.FRAGILE]
      }
      game.state.log.push(`${found.entry.name} is made Fragile`)
      return true
    },
  })
}

const SPITE = 'spiteOnPlay'
registerEffect(SPITE, fragileGrant(SPITE, 'Choose an enemy vehicle to make Fragile'))

// Agony prints Spite's text on a 375k Blocker sub. Same factory, its OWN id —
// see fragileGrant's header for why the name is a parameter.
const AGONY = 'agonyOnPlay'
registerEffect(AGONY, fragileGrant(AGONY, 'Choose an enemy vehicle to make Fragile'))

// "When played, target enemy vehicle in this zone, it gains inoffensive."
//
// Hysteria's grant with Alarmed's stash. Its OWN id rather than a reuse of
// hysteriaOnPlay (spec R-6) — and here the two genuinely differ as well:
// Hysteria offers the whole board, Loathing only the zone it landed in.
//
// ⚠ The `data` stash is not an optimisation. targetZoneId is a
// first-entry-only field and RESOLVE_PENDING_EFFECT never sets it, so without
// the stash resolve has no "this zone" to re-check against and the card
// silently widens to Hysteria's scope.
//
// No placedInstanceIds exclusion is needed, unlike Alarmed's: the options are
// the ENEMY's hulls, and this play placed none of those.
const LOATHING = 'loathingOnPlay'
registerEffect(LOATHING, choice({
  effect: LOATHING,
  prompt: 'Choose an enemy vehicle in this zone to make Inoffensive',
  options: ({ game, actor, targetZoneId }) => (
    typeof targetZoneId === 'number' ? enemyVehicleOptions(game, actor, targetZoneId) : []
  ),
  data: ({ targetZoneId }) => ({ zoneId: targetZoneId }),
  resolve: ({ game, actor, pending }, choiceId) => {
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== otherSide(actor) || found.zone.id !== zoneId) return false
    if (!found.entry.keywords.includes(KEYWORDS.INOFFENSIVE)) {
      found.entry.keywords = [...found.entry.keywords, KEYWORDS.INOFFENSIVE]
    }
    game.state.log.push(`${found.entry.name} is made Inoffensive`)
    return true
  },
}))

// "When played, refresh all your hero powers and gain 1cp."
//
// ⚠ Deliberately not Kraken's shape. Kraken and SS Hydra refresh ONE power and
// need choice(); "all" leaves nothing to choose. Skipping the suspension is a
// real difference, not a shortcut: choice() DROPS a second offer made in the
// same action, and Kraken keeps its CP through that only by granting it inside
// resolve. Wonder never takes the slot, so its CP is unconditional by
// construction.
//
// state.usedHeroPowers[side] is the only gate USE_HERO_POWER consults
// (shared/engine/heroPowers.ts:131), so clearing the list IS the refresh.
// The list is already in PublicGameState, so naming the refresh leaks nothing.
registerEffect('wonderOnPlay', ({ game, actor, card }) => {
  const used = game.state.usedHeroPowers[actor]
  if (used.length > 0) {
    game.state.usedHeroPowers[actor] = []
    game.state.log.push(
      `${card.name} refreshes every hero power for player ${actor.toUpperCase()}`,
    )
  }
  game.state.resources[actor].cp += 1
  return true
})

// "Target a friendly TG vehicle. destroy it. gain resources this turn equal to
// its cost."
//
// ⚠ Ruling TG-1 — "its cost" is effectiveMaterialCostOf, NEVER
// effectiveCostInGame. The latter sums costModifier, the stored costDelta
// stamp and the active resourceSurge delta: all three are about PAYING for a
// card out of hand, and this target is a hull already deployed and already
// paid for. Spec ruling U-1 makes the identical call for upkeep, and
// repairCostOf, baseDamageFrom, upkeepOwedBy and Boarding Party all read the
// same authority for the same reason. sapphireEffect's use of the play-time
// one is not a counter-example: it refunds the card being played, from hand,
// at that instant.
//
// ⚠ Ruling TG-2 — "destroy it" FIRES onDeathEffect. Spec R-7 rules the mirror
// for WF Sub Strike ("remove it from play" does not), and the two phrasings
// are one line apart here. sacrificeEntry alone would be the removal case;
// the fireDeathEffect below is what makes this the destruction case. The
// ORDER matters as well as the call: nostalgiaOnDeath pulls its snapshot back
// out of the discard that sacrificeEntry just filed, which is the same
// sequence battleResolve uses.
//
// ⚠ Ownership and faction are validated HERE because the handler does not:
// PLAY_CARD_TARGETING_CARD_ON_FIELD checks only that the target is on the
// field (ruling E-5, the same gap both Factories close by hand). The FACTION
// check is load-bearing: drop it and a friendly non-TG hull (found.side ===
// actor, so sacrificeEntry's actor-keyed lookup succeeds) is scrapped and
// paid out — "refuses a friendly hull of another faction" pins exactly that.
// The OWNERSHIP check, by contrast, is redundant with sacrificeEntry's own
// actor-keyed lookup below: sacrificeEntry(game, actor, targetInstanceId, …)
// searches zone.cards[actor], never zone.cards[found.side], so an enemy
// target (found.side !== actor) already fails there regardless of this
// guard — "refuses an enemy hull" passes with or without it. Kept anyway as
// defence in depth against a future refactor that passes found.side instead
// of actor to sacrificeEntry, which would silently reopen the hole.
//
// "this turn" needs no mechanic. endTurn ASSIGNS the material pool from the
// turn number rather than incrementing it, so every material gain in the game
// already expires with the turn.
//
// Balance, recorded rather than fixed: Spawn Audacious mints a Half-Cost
// Audacious for 40k, and Repurpose converts that hull to 330k for 1cp. Two
// cards and a CP for a ~290k swing is a real loop. Both numbers are the
// spec's (§6.4) and neither card's text admits a guard against it. The
// surface is wider than that one pairing: ANY board-spawned TG hull converts
// at its printed cost, no matter how it arrived — Fear spawns a Horror (50k
// after this wave) into every zone for free, and Horror self-copies on every
// offensive battle it survives, so a single Fear can feed Repurpose a growing
// supply of free 50k payouts with no second card played.
registerEffect('repurposeEffect', ({ game, actor, ctx, card, targetInstanceId }) => {
  if (typeof targetInstanceId !== 'string') return false
  const found = findVehicle(game.state, targetInstanceId)
  if (!found || found.side !== actor) return false
  if (found.entry.faction !== FACTIONS.TG) return false
  // Read before the hull leaves the board, so the payout cannot depend on
  // ordering.
  const entry = found.entry
  const value = effectiveMaterialCostOf(entry)
  if (!sacrificeEntry(game, actor, targetInstanceId, found.zone.id)) return false
  fireDeathEffect(game, ctx, actor, entry)
  game.state.resources[actor].materials += value
  game.state.log.push(`${card.name} scraps ${entry.name} for ${value} materials`)
  return true
})

// "Spawn an audacious into target zone. It is not temporary."
//
// spawnBuccaneerEffect's shape with its OWN registry id (spec R-6): reusing
// the DWG name would rebind that card's behaviour for every in-flight game the
// moment this one deployed (Kraken/Paddlegun).
//
// Minted through mintHull rather than hand-stamped: mintHull is documented
// (primitives.ts) as the ONE place the per-entry stamp list (playedOnTurn,
// movedOnTurn, activatedOnTurn) lives, and re-implementing it inline here
// would drift the moment a future stamp is added there and skipped here —
// a silent gap rather than a wrong value, and worse for it. mintHull's own
// keyword param only ADDS to the snapshot's printed list, and can never
// express "remove one" — so the keyword field is overridden immediately
// after, the one deliberate departure from composing straight through.
//
// ⚠ The keyword override is the one thing NOT copied from spawnBuccaneerEffect
// verbatim, and copying it would be the bug. DWG writes
// `keywords: [KEYWORDS.SCRAPPY]`, replacing the snapshot's list outright —
// harmless there only because Buccaneer prints none. Audacious prints
// HALF_COST and TEMPORARY, so the same literal would strip both and grant a
// Scrappy this card never mentions. The text removes exactly one keyword, so
// this removes exactly one.
//
// SPAWNING IS NOT PLAYING (spec §7.4): no payment, no placement legality, no
// onPlayEffect, and no zone-cap check — the same latitude every other spawn
// takes.
registerEffect('spawnAudaciousEffect', ({ game, actor, ctx, targetZoneId }) => {
  if (typeof targetZoneId !== 'number') return false
  const zone = zoneById(game.state, targetZoneId)
  const audacious = catalogCard(ctx, 'Audacious')
  // A missing catalog row is a data bug, not an empty pool: fail the play
  // rather than fizzle, matching spawnVehicles' contract.
  if (!zone || !audacious) return false
  const entry: ZoneCardEntry = {
    ...mintHull(game, ctx, audacious),
    keywords: audacious.keywords.filter((k) => k !== KEYWORDS.TEMPORARY),
  }
  zone.cards[actor].push(entry)
  game.state.log.push(`An Audacious joins zone ${zone.id}`)
  return true
}, { needsCatalog: true })

// "When this vehicle is played, sacrifice a target friendly AI vehicle in this
// zone." Clause 1 (the deploy prerequisite) is a data key read by
// legalZonesFor; this is clause 2.
//
// ⚠ THE CARD'S MOST LIKELY BUG, and why the filter is not just `isBuiltIn`:
// PLAY_CARD_TO_ZONE places the hull BEFORE effects fire, so Alarmed is already
// in zone.cards[actor] when this runs — and Alarmed is itself built-in, so a
// naive read offers it as its own sacrifice. `placedInstanceIds` is on the
// payload for exactly this, and it covers the additionalSpawns copies of the
// same play too.
//
// ⚠ Ruling D-2: this fires NO onDeathEffect. sacrificeEntry calls discardCard
// directly and never fireDeathEffect — the deliberate split behind decision 28
// ("destroy" fires, "remove from play" does not). Jealousy is a TG card whose
// entire text is a death draw, so a TG player meets this within one game.
//
// ✅ sacrificeEntry routes through discardCard, the single exit out of play, so
// a captured hull still goes home and a summonOnly one never reaches a discard.
const ALARMED = 'alarmedOnPlay'
registerEffect(ALARMED, choice({
  effect: ALARMED,
  prompt: 'Choose a friendly AI vehicle in this zone to sacrifice',
  options: ({ game, actor, targetZoneId, placedInstanceIds }) => {
    if (typeof targetZoneId !== 'number') return []
    const placed = new Set(placedInstanceIds ?? [])
    // isBuiltIn is ruling D-1's "AI vehicle"; the placed-id exclusion is what
    // keeps Alarmed from eating itself.
    return friendlyVehicleOptions(
      game, actor, targetZoneId, (e) => e.isBuiltIn && !placed.has(e.instanceId),
    )
  },
  // The zone is stashed because resolve cannot re-derive it: payload.card is
  // Alarmed and pendingEffect carries it verbatim, but targetZoneId is a
  // first-entry-only field and RESOLVE_PENDING_EFFECT never sets it.
  data: ({ targetZoneId }) => ({ zoneId: targetZoneId }),
  resolve: ({ game, actor, card, pending }, choiceId) => {
    // No eligible hull is not a failure: clause 1 guarantees an AI vehicle in
    // the zone, but it may be Alarmed's own additionalSpawns copy.
    if (choiceId === null) return true
    const zoneId = pending?.data?.zoneId
    if (typeof zoneId !== 'number') return false
    // Re-checked against the board rather than trusted from the first entry.
    const found = findVehicle(game.state, choiceId)
    if (!found || found.side !== actor || found.zone.id !== zoneId) return false
    if (!sacrificeEntry(game, actor, choiceId, zoneId)) return false
    game.state.log.push(`${card.name} sacrifices ${found.entry.name}`)
    return true
  },
}))

// "Whenever a horror participates in an offensive fleet battle, create anther
// copy of it in this zone. Max one spawn per zone." (`anther` is the card's
// own typo, reproduced verbatim in cardText because card text is data.)
//
// ⚠ Ruling D-3 — "a horror" is THIS Horror. The sentence continues "create
// another copy OF IT", which points back at the same hull, and DP2 already
// dispatches per participant. Reading it as "any Horror anywhere" would need
// DP8's dispatch and is a much bigger card than it looks.
//
// ⚠ Ruling D-4 — "max one spawn per zone" is per TURN, read off the board.
// Each fire() is an isolated invocation with no shared scratchpad, so any
// counter has to be read off state; a Horror in this zone already stamped with
// the current turn IS this turn's spawn, and that needs no new field.
//
// ⚠ Recorded, not fixed: reading the cap off the board makes it asymmetric
// between a same-turn Horror that SURVIVES its battle (it keeps this turn's
// stamp, matches itself below, and correctly blocks a second copy) and one
// that DIES in the same battle (the destruction branch splices it out of
// zone.cards before this dispatch runs, taking its stamp with it, so a
// same-turn spawner reads as unstamped again). That gap is reachable within
// one turn without any new state: Horror H attacks and survives, minting copy
// C1 stamped this turn; a Duel that same turn choosing C1 kills it, which
// removes the only stamped copy from the zone; H's next offensive battle this
// turn then reads as unstamped and mints a second copy C2 into the same zone.
// Two spawns land in one turn this way, though each extra iteration still
// costs a Duel card and net board growth per iteration stays +1. A real fix
// needs a turn stamp that survives the kill — e.g. carried on the discard
// snapshot rather than read off board presence — and is out of scope here.
//
// ⚠ Recorded by wave 7's late re-read: `playedOnTurn` cannot tell a Horror that
// COPIED into this zone this turn from one that ARRIVED here this turn by any
// other route — Fear's spawn, or an ordinary play. So a Horror that Fear
// dropped on turn N and which then survives a battle still on turn N produces
// no copy. That errs toward FEWER copies on the wave's acknowledged balance hot
// spot (a 50k self-replicating hull), and distinguishing the two would need the
// per-zone counter D-4 deliberately avoided. Left as the conservative reading.
//
// ⚠ Balance, recorded rather than fixed. This pass makes Horror strictly
// stronger three ways at once: 70k → 50k, UPKEEP_REQUIRED dropped, and the
// copy no longer requires surviving. Together with Fear (800k → 500k), which
// spawns a Horror into every zone, that is a self-replicating engine on a
// hull with no running cost. Recorded here because the wave-7 comment already
// named Horror as this faction's balance hot spot, and the pass has doubled
// down on it deliberately (2026-09-02 spec §6.4).
registerEffect('horrorBattle', ({ game, actor, ctx, card, battle }) => {
  // The 2026-09-02 pass: an AGGRESSOR gate replaces the survival gate.
  // "Offensive" is `!isDefender`, which dispatchBattleResolve computes as
  // `side !== aggressor` — true for the attacking side of a declared battle,
  // a forced one, and a Duel alike.
  if (!battle || battle.phase !== 'resolve' || battle.isDefender) return true
  const found = findVehicle(game.state, card.instanceId)
  // Unreachable side guard, kept: every dispatch hands `fire` the side the
  // entry was found on (the same latitude vengefulBattle documents).
  if (found && found.side !== actor) return true
  // ⚠ The zone can no longer come from findVehicle alone. A destroyed hull is
  // spliced out of zone.cards by the destruction branch BEFORE this dispatch
  // runs, so dropping the survival gate without this fallback leaves the card
  // silently inert on exactly the case the change exists for.
  //
  // battle.zoneId is EXACT here rather than approximate, and only because of
  // the aggressor gate above: every hull on the aggressor's side is in the
  // battle's own zone. ATTACK_ENEMY_FLEET validates attackers against
  // zone.cards, joinBattle requires the same for an on-board id, and a
  // cross-zone Duel sets zoneId to the AGGRESSOR's hull's zone. The away hull
  // of a cross-zone battle is always the defender, which this gate excludes.
  const zone = found?.zone ?? zoneById(game.state, battle.zoneId)
  if (!zone) return true
  // `card` IS the participant's ZoneCardEntry (battleTriggers.ts `fire`), so a
  // dead Horror's copy still carries the keywords it was granted in the fight.
  const source = (found?.entry ?? card) as ZoneCardEntry
  const alreadySpawned = zone.cards[actor].some(
    (c) => c.name === card.name && (c as ZoneCardEntry).playedOnTurn === game.turnNumber,
  )
  if (alreadySpawned) return true
  const copy: ZoneCardEntry = {
    ...source,
    instanceId: ctx.newId(),
    meta: (({ [FACTORY_ESCORT_KEY]: _escort, ...rest }) => rest)(copyMeta(source.meta)),
    keywords: [...source.keywords],
    playedOnTurn: game.turnNumber,
    movedOnTurn: null,
    activatedOnTurn: null,
  }
  zone.cards[actor].push(copy)
  game.state.log.push(`${card.name} splits in zone ${zone.id}`)
  return true
})

// "Whenever this would be destroyed, put it back into your hand."
//
// ⚠ Ruling E-1 — BATTLE DEATH ONLY. "Would be destroyed" is broader on its
// face, but this is an onDeathEffect and sacrificeEntry never fires one (that
// is decision 28's split: "destroy" fires, "remove from play" does not), so a
// sacrificed Nostalgia is not saved. Scoped deliberately rather than by
// accident.
//
// ✅ Nostalgia prints no SCRAPPY, so checklist item 10 holds — and that rule
// exists for exactly this shape. Its owner still CHOOSES whether to pay the
// 80-90% repair; repairing means it survives and no trigger fires, which is
// correct.
//
// Balance note, not a defect: under this route it never reaches the discard,
// so it never reshuffles into the deck — it goes straight back to hand,
// indefinitely, for 13.5k of upkeep a turn.
registerEffect('nostalgiaOnDeath', ({ game, actor, ctx, card }) =>
  returnToHand(game, actor, card as ZoneCardEntry, ctx))

// "Whenever you lose a vehicle to a fleet battle (any zone) this unit deals
// 40k damage to the enemy base in this zone."
//
// DP8's only customer (spec §4.3). The { resolveBystander: true } flag is what
// puts it in the new pass — and what keeps every other battle trigger out of
// it, which is why it is load-bearing rather than bookkeeping.
//
// Three rulings live here:
//
//   E-2   per VEHICLE lost, not per battle. Two casualties on your side is
//         80k. `casualties` is on the context; nothing else could supply it,
//         because by resolve time state.destroyed holds bare snapshots with no
//         instanceId and no battle of origin.
//   E-2b  a Vengeful destroyed in that same battle fires nothing. This is NOT
//         free: `participants` still holds a destroyed hull's entry when the
//         resolve dispatch runs, so the participant pass DOES reach it. The
//         findVehicle guard below is what enforces it — the destruction branch
//         has already removed the hull from zone.cards.
//   E-3   it damages a base despite being a SUBMARINE. baseStrikersIn excludes
//         subs and the glossary says a sub "can never damage an enemy base",
//         but that rule governs BOMBARDMENT (ATTACK_ENEMY_BASE) and this is
//         card-forced damage. Card text is authoritative (decision 1), and the
//         Submarine glossary entry is amended to say "bombard" rather than
//         "damage". E-4 answers the same way for the same reason: an enemy
//         BLOCKER stops ATTACK_ENEMY_BASE, and this is not that handler.
//
// ⚠ The context's zoneId is the BATTLE's, and the card says "the enemy base in
// THIS zone" — Vengeful's. Re-derived with findVehicle, the way Braveheart
// re-derives its own zone from payload.card rather than stashing it.
//
// It must NOT stamp lastActivatedTurn (a card-forced consequence is not a zone
// activation — Eclipse alone does, from its own text), and it MUST call
// checkVictory, because this is a route to a base reaching 0 that
// ATTACK_ENEMY_BASE's own call cannot cover.
registerEffect('vengefulBattle', ({ game, actor, card, battle }) => {
  if (!battle || battle.phase !== 'resolve') return true
  const lost = battle.casualties.filter((c) => c.side === actor).length
  if (lost === 0) return true
  const found = findVehicle(game.state, card.instanceId)
  // ⚠ The `!found` half is E-2b and is LIVE: `participants` still holds a
  // destroyed hull's entry at resolve, so the participant pass does reach a
  // Vengeful that just died, and only this stops it firing.
  //
  // The side half is UNREACHABLE, and a surviving mutation proved it rather
  // than a comment claiming it: every dispatch hands `fire` the side the entry
  // was found on, and instanceIds are unique, so found.side always equals
  // actor. Kept as defence in depth against a future dispatch that is less
  // careful — the same latitude Terawatt's isDefender guard documents — but
  // there is no test that can pin it, and none should be invented.
  if (!found || found.side !== actor) return true // E-2b
  const enemy = otherSide(actor)
  const damage = Math.floor((lost * VENGEFUL_BASE_DAMAGE) / BASE_DAMAGE_DIVISOR)
  if (damage <= 0) return true
  found.zone.baseHp[enemy] = Math.max(0, found.zone.baseHp[enemy] - damage)
  game.state.log.push(
    `${card.name} strikes the enemy base in zone ${found.zone.id} for ${damage} (${found.zone.baseHp[enemy]} HP remains)`,
  )
  if (found.zone.baseHp[enemy] === 0) game.state.log.push(`Zone ${found.zone.id} has fallen`)
  checkVictory(game)
  return true
}, { resolveBystander: true })

// "Target friendly robotic vehicle. Whenever that vehicle is engaged in a
// fleet combat, spawn a Havoc/Mirth swarm to fight along side it."
//
// state.zoneEffects is per-ZONE. This is per-HULL, which is new — and the
// target is a live ZoneCardEntry with its own meta, so the trigger is STAMPED
// onto it under `factoryEscort`.
//
// ⚠ THE VALUE IS THE EFFECT'S OWN REGISTRY NAME, not the swarm's card name,
// and that is load-bearing three times over:
//
//   1. The game-action catalog probe scans every meta VALUE for a
//      CATALOG_EFFECTS member, regardless of key. The Factory card is spent
//      turns before the escort fires, so nothing else in play names the
//      effect — a card-name value would mean no catalog, and the escort would
//      die in production only, with every unit test green.
//   2. dispatchBattleLock dispatches it with the same `fire` helper the
//      printed triggers use, so there is no new dispatch machinery at all.
//   3. Each Factory's own name selects its own swarm, so one implementation
//      serves both cards without a second lookup table.
//
// ⚠ A DISTINCT KEY rather than overwriting the target's `onBattleEffect`, which
// the handoff proposed. Three things fall out: a hull may carry BOTH its own
// printed battle trigger and an escort (Obelisk does, and there is a test that
// it summons twice), no refusal branch is needed for an already-triggered
// target, and — the decisive one — `factoryEscort` CAN be named in
// discardSnapshotOf's strip list, whereas `onBattleEffect` never could, because
// Obelisk and Horror carry it as printed card data that must survive death.
//
// ⚠ Ruling E-5: PLAY_CARD_TARGETING_CARD_ON_FIELD checks only
// findVehicle(targetInstanceId) — NOT ownership — so this validates own-side
// AND robotic itself, or either Factory could be played onto an enemy hull.
function factory(effectName: string, swarmName: string): EffectFn {
  return ({ game, actor, ctx, card, battle, targetInstanceId }) => {
    // Escort half: dispatched at battle lock off the stamp. `battle` is the
    // only thing distinguishing the two entries — dwgWatersEffect's shape.
    if (battle) {
      if (battle.phase !== 'lock') return true
      const summons = summonHulls(game, ctx, swarmName, 1)
      if (!summons) return false
      const [hull] = summons
      if (!joinBattle(game, actor, hull.instanceId, hull)) return false
      game.state.log.push(`A ${swarmName} joins the battle alongside ${card.name}`)
      return true
    }
    // Play half: validate, then stamp.
    if (typeof targetInstanceId !== 'string') return false
    const found = findVehicle(game.state, targetInstanceId)
    if (!found || found.side !== actor) return false
    if (!found.entry.keywords.includes(KEYWORDS.ROBOTIC)) return false
    found.entry.meta = { ...found.entry.meta, [FACTORY_ESCORT_KEY]: effectName }
    game.state.log.push(`${card.name} is assigned to ${found.entry.name}`)
    return true
  }
}

registerEffect('havocFactoryEffect', factory('havocFactoryEffect', 'Havoc Swarm'), { needsCatalog: true })
registerEffect('mirthFactoryEffect', factory('mirthFactoryEffect', 'Mirth Swarm'), { needsCatalog: true })

// "Target a friendly and enemy vehicle. They can be in different zones. they
// 1v1."
//
// ✅ PLAY_ABILITY_CARD accepts this shape: Duel carries no playOn* target key,
// so `needsTarget` is false and all targeting happens inside the choice chain.
//
// TWO HOPS, both routed through choice(). Orbit Flank writes its second
// pendingEffect BY HAND, which bypasses choice()'s one-slot check and can
// clobber an offer already owed; docs/claude/card-effects.md says explicitly to
// route a new suspension through choice() instead, so hop 2 is its own choice()
// closure invoked with `resolution` cleared. RESOLVE_PENDING_EFFECT has already
// nulled state.pendingEffect by then, so the slot is free for it to take.
//
// The hop-1 pick is carried in hop 2's `data`, never read back off
// resolution.targetInstanceId, which is client-supplied and unvalidated — and
// re-checked against the board on resolve, because the hull may have left while
// the dialog sat open.
//
// Rulings: the aggressor is the DUEL PLAYER (E-7), which decides isDefender for
// every DP2 trigger in the battle; and it activates NEITHER zone (E-8) — a
// forced battle is not a zone activation, and Eclipse alone passes
// activatesZone, from its own text.
const DUEL = 'duelEffect'

function resolveDuel(payload: EffectPayload, friendlyId: string, enemyId: string | null): boolean {
  const { game, actor, ctx, card } = payload
  // No enemy vehicle anywhere: the duel simply fizzles rather than failing.
  if (enemyId === null) {
    game.state.log.push(`${card.name} finds no enemy vehicle to challenge`)
    return true
  }
  const mine = findVehicle(game.state, friendlyId)
  const theirs = findVehicle(game.state, enemyId)
  if (!mine || mine.side !== actor) return false
  // ⚠ Ruling E-10. The friendly pick becomes attackerIds[0] of a forced
  // battle, and §7.3's Gang Up ruling is explicit: INOFFENSIVE means "cannot
  // attack", and a forced battle is not licence to break it. Re-checked here
  // as well as filtered in the offer, because the hull may have GAINED the
  // keyword between the two hops — an enemy TG Hysteria grants it.
  if (mine.entry.keywords.includes(KEYWORDS.INOFFENSIVE)) return false
  if (!theirs || theirs.side !== otherSide(actor)) return false
  // zoneId is the battle's HOME zone — the duelling player's own hull's. The
  // away hull is resolved by id, which is what `crossZone` switches on.
  return declareForcedBattle(game, ctx, {
    zoneId: mine.zone.id,
    aggressor: actor,
    attackerIds: [friendlyId],
    defenderIds: [enemyId],
    cause: card.name,
    crossZone: true,
    // "If the opponents vehicle dies, draw a card" (2026-09-02). The enemy id
    // is stashed because nothing on the continuation payload carries it —
    // Trebuchet stashes its zoneId for the same reason.
    continuation: { effect: DUEL, side: actor, card, data: { enemyId } },
  })
}

const duelHop2 = (friendlyId: string): EffectFn => choice({
  effect: DUEL,
  prompt: 'Choose an enemy vehicle for it to fight',
  options: ({ game, actor }) => enemyVehicleOptions(game, actor, null),
  data: () => ({ friendlyId }),
  resolve: (payload, enemyId) => resolveDuel(payload, friendlyId, enemyId),
})

const duelHop1: EffectFn = choice({
  effect: DUEL,
  prompt: 'Choose one of your vehicles to send into a duel',
  // Inoffensive hulls excluded (E-10): the pick attacks, and Inoffensive is
  // precisely "cannot attack". The ENEMY target is deliberately unfiltered —
  // Inoffensive can still DEFEND, which is Gang Up's shape exactly.
  options: ({ game, actor }) => friendlyVehicleOptions(
    game, actor, null, (e) => !e.keywords.includes(KEYWORDS.INOFFENSIVE),
  ),
  resolve: (payload, friendlyId) => {
    if (friendlyId === null) {
      payload.game.state.log.push(`${payload.card.name} finds no vehicle to send`)
      return true
    }
    // Hop 2's first entry: `resolution` cleared so choice() takes the slot
    // again, `pending` cleared so it cannot be mistaken for hop 2's own.
    return duelHop2(friendlyId)({ ...payload, resolution: undefined, pending: undefined })
  },
})

// Entry (c): the duel's battle has resolved. activeBattle is already null —
// DECIDE_BATTLE_REPORT nulls it before firing the continuation — so the
// outcome arrives on payload.battle, the SAME BattleContext the resolve
// triggers were handed, scoped to the Duel card itself.
//
// The kill test reads `casualties` and nothing else. By here the hull is out
// of zone.cards and state.destroyed holds a bare snapshot with no instanceId,
// so no board read can answer "did the hull I named die?".
//
// ⚠ A hull revived by Iron Cordon in the same DECIDE_BATTLE_REPORT is still
// in `casualties`, so the draw stands. That is DP2 departure 7's existing
// rule — a revive undoes the discard, not what already fired — rather than a
// new ruling.
function duelAftermath(payload: EffectPayload): boolean {
  const { game, actor, card, continuation, battle } = payload
  const enemyId = continuation?.data?.enemyId
  if (typeof enemyId !== 'string') return false
  const died = (battle?.casualties ?? []).some(
    (c) => c.side === otherSide(actor) && c.entry.instanceId === enemyId,
  )
  if (!died) return true
  // The log names the KILL, never the card drawn — it is entering a hidden
  // hand. grant() resyncs state.counts for us.
  game.state.log.push(`${card.name} claims its kill — a card is drawn`)
  return grant({ draw: 1 })(payload)
}

// The router. Hop 2 is told apart by the friendlyId hop 1 stashed — never by
// anything the client sent.
//
// ⚠ `continuation` is checked FIRST. A continuation re-entry carries neither
// `resolution` nor `pending`, so any later branch would fall through to hop 1
// and offer a fresh duel off the back of the battle that just resolved.
// dwgWatersEffect and trebuchetEffect both order their routers this way.
registerEffect(DUEL, (payload) => {
  if (payload.continuation !== undefined) return duelAftermath(payload)
  const stashed = payload.pending?.data?.friendlyId
  if (typeof stashed === 'string') return duelHop2(stashed)(payload)
  return duelHop1(payload)
})
