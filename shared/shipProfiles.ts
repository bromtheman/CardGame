import { DWG_SHIP_PROFILES } from './shipProfiles/DWG.ts'
import { LH_SHIP_PROFILES } from './shipProfiles/LH.ts'
import { SS_SHIP_PROFILES } from './shipProfiles/SS.ts'
import { WF_SHIP_PROFILES } from './shipProfiles/WF.ts'

// What each built-in hull is like in From The Depths — a glimpse for the
// deck builder's card details and a roster for PracticeAI's rules primer.
// Generated per faction from the FtDArmament `<Faction>.cards.md` reports by
// `scripts/import-ship-profiles.ts`, never hand-edited; keyed `FACTION:Name`,
// the key the seed derives card ids from, so a card and its profile can only
// drift apart by a rename, which shipProfiles.test.ts fails on.
//
// Nothing here is a card-game number. The scores are quintiles among the
// Neter campaign craft (1 = bottom fifth, 5 = top fifth) and the matchups are
// the report's judgement calls, so none of it rots against a balance pass —
// which is why, unlike the faction notes, this prose may carry digits. The
// report's FtD material cost is the one field deliberately left out: it
// contradicts the printed card cost.

export interface Rated {
  score: number
  why: string
}

export interface ShipProfile {
  // The fleet table's "What it is": "CRAM battleship, flagship".
  role: string
  // FtD's own overall power number, and the craft's rank among its faction's designs.
  strength: number
  rank: number
  // Set when the report writes the rank "#44=": other designs of the faction
  // share it (WF has four at strength 0, which FtD gives drills and rams).
  rankTied?: true
  type: string
  speed: string
  fightsAt: string
  sees: string
  escort?: string
  // Prose between the card table and the ratings, when the report has some.
  note?: string
  // The report's "In one line".
  summary: string
  scores: { firepower: Rated; toughness: Rated; speed: Rated; range: Rated; cost: Rated }
  matchups: { ships: Rated; aircraft: Rated; submarines: Rated; missiles: Rated }
  // "Verdict: <verdict>." and the sentence that follows it.
  verdict: string
  verdictDetail: string
}

export const SHIP_PROFILES: Record<string, ShipProfile> = {
  ...DWG_SHIP_PROFILES,
  ...LH_SHIP_PROFILES,
  ...SS_SHIP_PROFILES,
  ...WF_SHIP_PROFILES,
}

export function shipProfileOf(faction: string, name: string): ShipProfile | null {
  return SHIP_PROFILES[`${faction}:${name}`] ?? null
}

// One faction's profiles in report order — the fleet table lists craft
// cheapest first — each with the bare card name.
export function shipProfilesForFaction(faction: string): { name: string; profile: ShipProfile }[] {
  const prefix = `${faction}:`
  return Object.entries(SHIP_PROFILES)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, profile]) => ({ name: key.slice(prefix.length), profile }))
}
