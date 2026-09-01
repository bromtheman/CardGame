#!/usr/bin/env node
// Checks that every built-in vehicle card resolves to a blueprint file that
// actually exists in the local From The Depths install.
//
// The game's own filenames are inconsistent — spaces, underscores and outright
// typos (Bucanneer, Jormungand) — so name-derived paths silently miss. A missed
// path produces a battle file that loads with a vehicle quietly absent, which is
// far worse to debug than a failed build. Run this after touching card seed data.
//
//   node scripts/verify-blueprint-mapping.mjs
//   node scripts/verify-blueprint-mapping.mjs "D:\SteamLibrary\steamapps\common\From The Depths"

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cardsDir = join(repoRoot, 'supabase', 'seed', 'source', 'builtInCards')
const generatorPath = join(repoRoot, 'shared', 'customBattle.ts')

/**
 * Read BLUEPRINT_OVERRIDES out of shared/customBattle.ts.
 *
 * Regex rather than import: this is a .mjs script and the module is TypeScript.
 * The map is a flat literal of string pairs, so the parse is unambiguous — and
 * reading it here is what keeps the verifier honest about what the app will
 * actually resolve at runtime.
 */
function readOverrides() {
  const text = readFileSync(generatorPath, 'utf8')
  const block = text.match(/BLUEPRINT_OVERRIDES[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!block) throw new Error(`Could not find BLUEPRINT_OVERRIDES in ${generatorPath}`)
  const overrides = {}
  for (const [, k, v] of block[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) overrides[k] = v
  return overrides
}

const DEFAULT_GAME_PATHS = [
  'D:\\SteamLibrary\\steamapps\\common\\From The Depths',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\From The Depths',
]

function findBlueprintRoot() {
  const explicit = process.argv[2]
  const candidates = explicit ? [explicit] : DEFAULT_GAME_PATHS
  for (const c of candidates) {
    // Accept either the game root or the Neter folder itself.
    const asRoot = join(c, 'From_The_Depths_Data', 'StreamingAssets', 'Blueprints', 'Neter')
    if (existsSync(asRoot)) return asRoot
    if (existsSync(c) && basename(c) === 'Neter') return c
  }
  return null
}

/** Every blueprint file, as "FACTION/Name" with the extension stripped. */
function indexBlueprints(root) {
  const index = new Set()
  for (const faction of readdirSync(root)) {
    const dir = join(root, faction)
    if (!statSync(dir).isDirectory()) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.blueprint')) continue
      index.add(`${faction}/${file.slice(0, -'.blueprint'.length)}`)
    }
  }
  return index
}

/**
 * Pull cards out of the seed sources.
 *
 * These files are ESM that imports extensionless paths, so node cannot import them
 * directly and a regex pass is the pragmatic read. It only needs four fields, and
 * the verifier fails loudly if a block parses to something incomplete.
 */
function readCards() {
  const cards = []
  for (const file of readdirSync(cardsDir).filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(join(cardsDir, file), 'utf8')
    for (const block of text.split(/\n\s*\},?/)) {
      const name = block.match(/\bname:\s*'([^']*)'/)?.[1]
      const type = block.match(/\btype:\s*'([^']*)'/)?.[1]
      const faction = block.match(/\bfaction:\s*FACTIONS\.(\w+)/)?.[1]
      const blueprintId = block.match(/\bblueprintId:\s*'([^']*)'/)?.[1] ?? null
      if (!name || type !== 'vehicle') continue
      if (!faction) {
        cards.push({ name, faction: null, blueprintId, source: file })
        continue
      }
      cards.push({ name, faction, blueprintId, source: file })
    }
  }
  return cards
}

/** Levenshtein distance, capped — only used to suggest a fix in error output. */
function distance(a, b) {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Best guess at the blueprint a card meant.
 *
 * Tries an exact match ignoring separators and case first (catches Land Marauder →
 * Land_Marauder), then falls back to nearest edit distance within the card's own
 * faction folder (catches the game's misspellings: Buccaneer → Bucanneer).
 */
function suggest(card, blueprints) {
  if (!card.faction) return ''
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = norm(`${card.faction}/${card.name}`)

  const exact = [...blueprints].find((b) => norm(b) === target)
  if (exact) return `  → try blueprintId: '${exact}'`

  // The blueprint may live under another faction's folder — two of the seeded cards
  // genuinely do — so an exact name match anywhere beats a fuzzy one at home.
  const crossFaction = [...blueprints].find((b) => norm(b.split('/').slice(1).join('/')) === norm(card.name))
  if (crossFaction) return `  → found under another faction: blueprintId: '${crossFaction}'`

  const sameFaction = [...blueprints].filter((b) => b.startsWith(`${card.faction}/`))
  let best = null
  let bestD = Infinity
  for (const b of sameFaction) {
    const d = distance(norm(card.name), norm(b.slice(card.faction.length + 1)))
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  // Beyond a couple of edits the suggestion is noise, not help.
  if (best && bestD <= Math.max(2, Math.round(card.name.length * 0.25))) {
    return `  → did you mean blueprintId: '${best}'?`
  }
  return ''
}

const root = findBlueprintRoot()
if (!root) {
  console.error('Could not find the Neter blueprints folder.')
  console.error('Pass your game path: node scripts/verify-blueprint-mapping.mjs "<path to From The Depths>"')
  process.exit(2)
}

const blueprints = indexBlueprints(root)
const cards = readCards()
const overrides = readOverrides()

const missing = []
for (const card of cards) {
  if (!card.faction) {
    missing.push({ ...card, reason: 'no faction parsed from seed block' })
    continue
  }
  // Same precedence resolveBlueprintPath uses: blueprintId, override map, derived.
  const rel =
    card.blueprintId ?? overrides[`${card.faction}/${card.name}`] ?? `${card.faction}/${card.name}`
  if (!blueprints.has(rel)) missing.push({ ...card, reason: `no blueprint at "${rel}"` })
}

console.log(`Blueprints indexed : ${blueprints.size} (${root})`)
console.log(`Vehicle cards      : ${cards.length}`)
console.log(`Overrides applied  : ${Object.keys(overrides).length}`)
console.log(`Unresolved         : ${missing.length}`)

if (missing.length) {
  console.log('')
  for (const m of missing) {
    const hint = suggest(m, blueprints)
    console.log(`  ${m.source.padEnd(20)} ${m.name.padEnd(24)} ${m.reason}${hint}`)
  }
  console.log('')
  console.log('Add each card above to BLUEPRINT_OVERRIDES in shared/customBattle.ts,')
  console.log('keyed "<faction>/<card name>" with the path shown.')
  process.exit(1)
}

console.log('\nAll vehicle cards resolve to a real blueprint.')
