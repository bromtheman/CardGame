import { grant } from './primitives.ts'
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
