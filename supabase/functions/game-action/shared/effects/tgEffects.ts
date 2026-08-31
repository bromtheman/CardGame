import { choice, enemyVehicleOptions, grant, spawnVehicles, summonHulls } from './primitives.ts'
import { joinBattle } from '../engine/battleDeclare.ts'
import { findVehicle } from '../engine/gameEngine.ts'
import { KEYWORDS } from '../gameSettings.ts'
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
