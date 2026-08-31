import { grant, spawnVehicles } from './primitives.ts'
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
