import type { ShipProfile } from '../../shared/shipProfiles'

// Turns one FtDArmament `<Faction>.cards.md` report into ShipProfile records
// keyed `FACTION:Name`. Only the "glimpse" survives: the fleet table's role
// and strength, the per-ship card table (minus its FtD material cost, which
// contradicts the printed card cost), the nine ratings with their reasons,
// and the verdict. Weapons and defence tables are skipped.
//
// The parser is strict on purpose: a section missing a rating or a verdict,
// a fleet-table craft without a section (or the reverse), or a fleet-table
// score that disagrees with the section all throw, naming the ship — the
// report is the source of truth and a slip in it should stop the import,
// not ship as data.

const SCORE_KEYS = ['firepower', 'toughness', 'speed', 'range', 'cost'] as const
const MATCHUP_KEYS = ['ships', 'aircraft', 'submarines', 'missiles'] as const

// Ratings-table row label → profile slot.
const RATING_ROWS: Record<string, { group: 'scores' | 'matchups'; key: string }> = {
  'Firepower': { group: 'scores', key: 'firepower' },
  'Toughness': { group: 'scores', key: 'toughness' },
  'Speed': { group: 'scores', key: 'speed' },
  'Range': { group: 'scores', key: 'range' },
  'Cost': { group: 'scores', key: 'cost' },
  'vs Ships': { group: 'matchups', key: 'ships' },
  'vs Aircraft': { group: 'matchups', key: 'aircraft' },
  'vs Submarines': { group: 'matchups', key: 'submarines' },
  'vs Missiles': { group: 'matchups', key: 'missiles' },
}

// Card-table row label → profile field. "Cost" is deliberately absent.
const CARD_ROWS: Record<string, 'type' | 'speed' | 'fightsAt' | 'sees' | 'escort' | 'summary'> = {
  'Type': 'type',
  'Speed': 'speed',
  'Fights at': 'fightsAt',
  'Sees': 'sees',
  'Escort': 'escort',
  'In one line': 'summary',
}

const unbold = (s: string): string => s.replace(/\*\*/g, '').trim()

// `| a | b | c |` → ['a', 'b', 'c'] (cells trimmed, outer pipes dropped).
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

const isTableRow = (line: string): boolean => line.trim().startsWith('|')
const isTableRule = (line: string): boolean => /^\|[\s\-|:]+\|$/.test(line.trim())

interface FleetRow {
  role: string
  strength: number
  rank: number
  rankTied: boolean
  scores: number[]
  matchups: number[]
}

// The "Fleet at a glance" table: name → role, strength, rank ("#44=" is a
// tie), and the two dotted score strings, which the per-ship sections are
// checked against.
function parseFleetTable(lines: string[]): Map<string, FleetRow> {
  const start = lines.findIndex((l) => l.trim() === '## Fleet at a glance')
  if (start < 0) throw new Error('report has no "## Fleet at a glance" section')
  const rows = new Map<string, FleetRow>()
  let inTable = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) break
    if (!isTableRow(line)) { if (inTable) break; continue }
    if (isTableRule(line)) continue
    const c = cells(line)
    if (c[0] === 'Craft') { inTable = true; continue }
    if (!inTable) continue
    const [name, role, , strengthCell, scoreCell, matchupCell] = c
    const strength = strengthCell.match(/^([\d,]+)\s+\(#(\d+)(=?)\)$/)
    if (!strength) throw new Error(`fleet table: cannot read strength/rank for ${name}: "${strengthCell}"`)
    const dotted = (s: string): number[] => s.split('·').map((n) => Number(n))
    rows.set(name, {
      role,
      strength: Number(strength[1].replace(/,/g, '')),
      rank: Number(strength[2]),
      rankTied: strength[3] === '=',
      scores: dotted(scoreCell),
      matchups: dotted(matchupCell),
    })
  }
  if (rows.size === 0) throw new Error('fleet table has no craft rows')
  return rows
}

interface Section { name: string; lines: string[] }

// Every `## Name` after the fleet table, up to the next `## `.
function shipSections(lines: string[]): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  let pastFleet = false
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const name = line.slice(3).trim()
      if (name === 'Fleet at a glance') { pastFleet = true; current = null; continue }
      if (!pastFleet) continue
      current = { name, lines: [] }
      sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return sections
}

function parseSection(name: string, lines: string[], fleet: FleetRow): ShipProfile {
  // A declaration with an explicit never return, so a call narrows what follows.
  function fail(what: string): never { throw new Error(`${name}: ${what}`) }
  const cardStart = lines.findIndex((l) => l.trim() === '### The card')
  const ratingsStart = lines.findIndex((l) => l.trim() === '### Ratings')
  if (cardStart < 0) fail('no "### The card" table')
  if (ratingsStart < 0) fail('no "### Ratings" table')

  // The card table, then any prose between it and the ratings (a note).
  const fields: Partial<Record<(typeof CARD_ROWS)[string], string>> = {}
  const noteLines: string[] = []
  for (let i = cardStart + 1; i < ratingsStart; i++) {
    const line = lines[i]
    if (isTableRow(line)) {
      if (isTableRule(line)) continue
      const [label, value] = cells(line)
      const field = CARD_ROWS[unbold(label)]
      if (field) fields[field] = unbold(value)
      continue
    }
    if (line.trim()) noteLines.push(line.trim())
  }
  for (const required of ['type', 'speed', 'fightsAt', 'sees', 'summary'] as const) {
    if (!fields[required]) fail(`card table has no "${required}" row`)
  }

  // The ratings table.
  const scores: Partial<Record<string, { score: number; why: string }>> = {}
  const matchups: Partial<Record<string, { score: number; why: string }>> = {}
  let i = ratingsStart + 1
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('### ') || line.startsWith('**Verdict')) break
    if (!isTableRow(line) || isTableRule(line)) continue
    const [label, scoreCell, why] = cells(line)
    if (label === 'Rating') continue
    const slot = RATING_ROWS[label]
    if (!slot) fail(`unknown rating row "${label}"`)
    const m = scoreCell.match(/([1-5])\s*$/)
    if (!m) fail(`cannot read the ${slot.key} score from "${scoreCell}"`)
    ;(slot.group === 'scores' ? scores : matchups)[slot.key] = { score: Number(m[1]), why: unbold(why) }
  }
  for (const key of SCORE_KEYS) if (!scores[key]) fail(`ratings table has no ${key} row`)
  for (const key of MATCHUP_KEYS) if (!matchups[key]) fail(`ratings table has no ${key} row`)

  // The fleet table must agree with the section on every score.
  SCORE_KEYS.forEach((key, idx) => {
    if (fleet.scores[idx] !== scores[key]!.score) fail(`fleet table says ${key} ${fleet.scores[idx]}, the section says ${scores[key]!.score}`)
  })
  MATCHUP_KEYS.forEach((key, idx) => {
    if (fleet.matchups[idx] !== matchups[key]!.score) fail(`fleet table says vs ${key} ${fleet.matchups[idx]}, the section says ${matchups[key]!.score}`)
  })

  // The verdict paragraph.
  const verdictLine = lines.find((l) => l.startsWith('**Verdict:'))
  if (!verdictLine) fail('no verdict paragraph ("**Verdict: …**")')
  const v = verdictLine.match(/^\*\*Verdict:\s*(.+?)\.\*\*\s*(.*)$/)
  if (!v) fail(`cannot read the verdict from "${verdictLine}"`)

  const profile: ShipProfile = {
    role: fleet.role,
    strength: fleet.strength,
    rank: fleet.rank,
    ...(fleet.rankTied ? { rankTied: true as const } : {}),
    type: fields.type!,
    speed: fields.speed!,
    fightsAt: fields.fightsAt!,
    sees: fields.sees!,
    ...(fields.escort ? { escort: fields.escort } : {}),
    ...(noteLines.length ? { note: noteLines.join(' ') } : {}),
    summary: fields.summary!,
    scores: {
      firepower: scores.firepower!, toughness: scores.toughness!, speed: scores.speed!,
      range: scores.range!, cost: scores.cost!,
    },
    matchups: {
      ships: matchups.ships!, aircraft: matchups.aircraft!,
      submarines: matchups.submarines!, missiles: matchups.missiles!,
    },
    verdict: v[1].trim(),
    verdictDetail: v[2].trim(),
  }
  return profile
}

export function parseShipReport(markdown: string, faction: string): Record<string, ShipProfile> {
  const lines = markdown.split(/\r?\n/)
  const fleet = parseFleetTable(lines)
  const sections = shipSections(lines)
  const out: Record<string, ShipProfile> = {}
  for (const section of sections) {
    const row = fleet.get(section.name)
    if (!row) throw new Error(`${section.name}: section has no row in the fleet table`)
    out[`${faction}:${section.name}`] = parseSection(section.name, section.lines, row)
  }
  for (const name of fleet.keys()) {
    if (!out[`${faction}:${name}`]) throw new Error(`${name}: fleet-table row has no "## ${name}" section`)
  }
  return out
}

// The generated shared/shipProfiles/<FACTION>.ts. JSON rendering keeps the
// output deterministic; the file is data, not prose, so its quoting style
// does not need to match hand-written modules.
export function renderProfilesModule(faction: string, sourceName: string, profiles: Record<string, ShipProfile>): string {
  return [
    `// GENERATED by scripts/import-ship-profiles.ts from ${sourceName} — do not hand-edit.`,
    '// Re-run the importer on a fresh report instead; shared/shipProfiles.test.ts pins',
    '// every key here to a seeded card.',
    "import type { ShipProfile } from '../shipProfiles.ts'",
    '',
    `export const ${faction}_SHIP_PROFILES: Record<string, ShipProfile> = ${JSON.stringify(profiles, null, 2)}`,
    '',
  ].join('\n')
}
