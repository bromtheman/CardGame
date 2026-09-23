import type { Rated, ShipProfile } from '@shared/shipProfiles'

// Display rows for a ShipProfile's ratings — labels, the 1–5 score the
// SegmentBar draws, and a spoken form for that bar's aria-label — so
// CardDetailsModal only renders. Frontend-only, like keywords.ts: UI copy
// stays out of shared/.
//
// `why` is carried for every row but shown differently by each list: the four
// matchups print it (it names the armament), while the four scores keep it as
// a hover title only — the percentile wording was noise beside the bar.

export interface ProfileRow {
  key: string
  label: string
  score: number
  spoken: string
  why: string
}

// The profile's Cost score is left out on purpose: the dialog's Materials chip
// already shows what the card costs, so a bar for it only repeated that.
const SCORE_LABELS: [keyof ShipProfile['scores'], string][] = [
  ['firepower', 'Firepower'], ['toughness', 'Toughness'], ['speed', 'Speed'], ['range', 'Range'],
]
const MATCHUP_LABELS: [keyof ShipProfile['matchups'], string][] = [
  ['ships', 'vs Ships'], ['aircraft', 'vs Aircraft'], ['submarines', 'vs Submarines'], ['missiles', 'vs Missiles'],
]

function row(key: string, label: string, rated: Rated): ProfileRow {
  return { key, label, score: rated.score, spoken: `${label} ${rated.score} of 5`, why: rated.why }
}

export function shipProfileRows(profile: ShipProfile): { scores: ProfileRow[]; matchups: ProfileRow[] } {
  return {
    scores: SCORE_LABELS.map(([key, label]) => row(key, label, profile.scores[key])),
    matchups: MATCHUP_LABELS.map(([key, label]) => row(key, label, profile.matchups[key])),
  }
}

// The panel's header line: what it is, FtD's strength number, and where it
// ranks among its faction's designs — "joint" when the report ties it.
export function shipProfileHeadline(profile: ShipProfile, faction: string): string {
  const rank = `${profile.rankTied ? 'joint ' : ''}#${profile.rank}`
  return `${profile.role} · FtD strength ${profile.strength.toLocaleString('en-US')} · ${rank} among ${faction} designs`
}
