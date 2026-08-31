import {
  choice, enemyVehicleOptions, friendlyVehicleOptions, grant, spawnVehicles, summonHulls,
} from './primitives.ts'
import { joinBattle } from '../engine/battleDeclare.ts'
import { copyMeta, findVehicle } from '../engine/gameEngine.ts'
import { sacrificeEntry } from '../engine/battleTriggers.ts'
import { KEYWORDS } from '../gameSettings.ts'
import type { ZoneCardEntry } from '../engine/engineTypes.ts'
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
// Balance note, recorded rather than fixed: Fear is 120k/turn of upkeep and
// its three Horrors add 31.5k. That is 18.4% of the income available on turn
// 11, the first turn an 800k card can be played at all (spec §7.3, U-8).
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
    if (!enemyVehicleOptions(game, actor, null).some((o) => o.id === choiceId)) return false
    const found = findVehicle(game.state, choiceId)
    if (!found) return false
    // Idempotent, matching grantKeywords: a keyword already carried is not
    // duplicated.
    if (!found.entry.keywords.includes(KEYWORDS.INOFFENSIVE)) {
      found.entry.keywords = [...found.entry.keywords, KEYWORDS.INOFFENSIVE]
    }
    game.state.log.push(`${found.entry.name} is made Inoffensive`)
    return true
  },
}))

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

// "Whenever a horror survives a fleet battle, create anther copy of it in this
// zone. Max one spawn per zone." (`anther` is the card's own typo, reproduced
// verbatim in cardText because card text is data.)
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
// ✅ It copies the surviving ENTRY rather than minting from the catalog, which
// is what carries keywords GRANTED to that hull across (clydesdaleEffect and
// loggerheadOnDeath are the precedents) — and is why this effect needs no
// { needsCatalog: true } and meets no fireRider trap: it is a participant
// trigger, not a zoneEffects rider.
//
// The zone comes from findVehicle rather than from battle.zoneId: the two
// agree for a participant today, but the hull's own zone is what the card
// says, and Braveheart sets the precedent for re-deriving it.
registerEffect('horrorBattle', ({ game, actor, ctx, card, battle }) => {
  if (!battle || battle.phase !== 'resolve' || !battle.survived) return true
  const found = findVehicle(game.state, card.instanceId)
  // Destroyed hulls are still in `participants` when the resolve dispatch
  // runs, so this is reachable rather than defensive.
  if (!found || found.side !== actor) return true
  const alreadySpawned = found.zone.cards[actor].some(
    (c) => c.name === card.name && (c as ZoneCardEntry).playedOnTurn === game.turnNumber,
  )
  if (alreadySpawned) return true
  const copy: ZoneCardEntry = {
    ...found.entry,
    instanceId: ctx.newId(),
    meta: copyMeta(found.entry.meta),
    keywords: [...found.entry.keywords],
    playedOnTurn: game.turnNumber,
    movedOnTurn: null,
    activatedOnTurn: null,
  }
  found.zone.cards[actor].push(copy)
  game.state.log.push(`${card.name} splits in zone ${found.zone.id}`)
  return true
})
