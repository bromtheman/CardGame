import type { Rated, ShipProfile } from '@shared/shipProfiles'

// Display rows for a ShipProfile's nine ratings — labels, a five-pip meter
// and a spoken form for the meter's aria-label — so CardDetailsModal only
// renders. Frontend-only, like keywords.ts: UI copy stays out of shared/.

export interface ProfileRow {
  key: string
  label: string
  score: number
  meter: string
  spoken: string
  why: string
}

const SCORE_LABELS: [keyof ShipProfile['scores'], string][] = [
  ['firepower', 'Firepower'], ['toughness', 'Toughness'], ['speed', 'Speed'], ['range', 'Range'], ['cost', 'Cost'],
]
const MATCHUP_LABELS: [keyof ShipProfile['matchups'], string][] = [
  ['ships', 'vs Ships'], ['aircraft', 'vs Aircraft'], ['submarines', 'vs Submarines'], ['missiles', 'vs Missiles'],
]

export function pips(score: number): string {
  return '●'.repeat(score) + '○'.repeat(5 - score)
}

function row(key: string, label: string, rated: Rated): ProfileRow {
  return { key, label, score: rated.score, meter: pips(rated.score), spoken: `${label} ${rated.score} of 5`, why: rated.why }
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
