// Turning a result reported by the From The Depths mod into report-form values.
//
// Pure on purpose, and deliberately free of any `supabaseClient` import: the
// root vitest runner has no `envDir`, so anything that transitively imports the
// client throws at collection time over missing VITE_ vars (docs/claude/testing.md).
// The network half lives in `ftdReporting.ts`; everything worth a unit test
// lives here.
//
// The prefill is ADVISORY. Nothing in this path submits anything: it fills the
// HP boxes in `BattleOverlay`'s report form, a human reads them and presses
// Submit, and the other captain still has to approve. That is why a mismatch
// between what FtD reported and who is actually in the battle is surfaced as a
// note rather than treated as an error.

/** The `reported` blob `battle-report`'s `fetch` op returns. Every field is distrusted. */
export interface FtdPrefill {
  version?: number
  results?: Record<string, number>
  names?: Record<string, string>
  winningTeamIndex?: number | null
  winningSide?: string | null
  reportedBySide?: string
  reportedAt?: string
}

export interface PrefillApplication {
  /** The full results map to hand the form: current values, overwritten where FtD had one. */
  results: Record<string, number>
  /** Participants FtD gave a number for. */
  matched: string[]
  /** Participants FtD said nothing about — left at whatever the form already had. */
  missing: string[]
  /** Ids FtD reported that are not in this battle — ignored. */
  unknown: string[]
}

/**
 * Merge a reported result onto the values the form currently holds.
 *
 * Merged rather than replaced, and scoped to `participantIds`, for the reason
 * SUBMIT_BATTLE_REPORT cares about: the report must cover **exactly** the
 * battle's participants. Writing an id FtD invented into the form would produce
 * a report the engine rejects with "The report must cover exactly the vehicles
 * in this battle" — a 400 the player could not act on. Dropping it instead
 * leaves a form that still submits, with one hull's number to fill in by hand.
 */
export function applyPrefill(
  current: Record<string, number>,
  prefill: FtdPrefill | null | undefined,
  participantIds: string[],
): PrefillApplication {
  const reported = prefill?.results ?? {}
  const known = new Set(participantIds)
  const results = { ...current }
  const matched: string[] = []
  const missing: string[] = []
  for (const id of participantIds) {
    const hp = reported[id]
    if (typeof hp === 'number' && Number.isFinite(hp)) {
      results[id] = Math.max(0, Math.min(100, Math.round(hp)))
      matched.push(id)
    } else {
      missing.push(id)
    }
  }
  const unknown = Object.keys(reported).filter((id) => !known.has(id))
  return { results, matched, missing, unknown }
}

/**
 * One line telling the captain what the mod actually covered.
 *
 * Names the hulls it could not fill in, because "3 of 4" leaves the player
 * hunting for which row still needs typing. `nameOf` comes from the overlay's
 * own roster rather than the mod's reported names — the roster is authoritative
 * and the mod's copy is only a debugging aid.
 */
export function prefillSummary(
  app: PrefillApplication, nameOf: (id: string) => string,
): string {
  if (app.matched.length === 0) {
    return 'From The Depths reported this battle, but none of its vehicles matched this fleet.'
  }
  const parts = [`Filled in ${app.matched.length} of ${app.matched.length + app.missing.length} vehicles.`]
  if (app.missing.length > 0) {
    parts.push(`Not reported: ${app.missing.map(nameOf).join(', ')} — enter these by hand.`)
  }
  if (app.unknown.length > 0) {
    parts.push(`${app.unknown.length} reported vehicle(s) are not in this battle and were ignored.`)
  }
  return parts.join(' ')
}

/** "the DWG fleet won" / null when the mod reported no winner we can place. */
export function winnerLabel(
  prefill: FtdPrefill | null | undefined, factionOf: (side: string) => string,
): string | null {
  const side = prefill?.winningSide
  if (side !== 'a' && side !== 'b') return null
  return `${factionOf(side)} won the fight in From The Depths.`
}
