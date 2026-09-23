import { KEYWORDS } from '../gameSettings.ts'
import type { ZoneCardEntry } from './engineTypes.ts'

// Decoy (2026-09-21 LH spec §3.6): the hull that must be targeted instead of
// `target`, or null when the pick stands. "Could target" is the effect's own
// filter, so Sub Strike beside a Watt's Luxon still hits the sub — Decoy
// redirects, it never blanks. Lane-scoped: `lane` is the target's own side of
// one zone.
export function decoyFor(
  lane: ZoneCardEntry[], target: ZoneCardEntry, couldTarget: (e: ZoneCardEntry) => boolean,
): ZoneCardEntry | null {
  if (target.keywords.includes(KEYWORDS.DECOY)) return null
  return lane.find((c) => c.keywords.includes(KEYWORDS.DECOY) && couldTarget(c)) ?? null
}
