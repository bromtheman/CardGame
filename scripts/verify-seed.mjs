#!/usr/bin/env node
// Diffs the LIVE cards table against supabase/seed/seed_data.sql and exits
// non-zero on any drift.
//
// Why this exists
// ---------------
// `seed_data.sql` is applied OUT OF BAND. The Supabase GitHub integration runs
// clone → pull → health → configure → migrate → seed → deploy, but
// `supabase/config.toml` deliberately carries no seed settings (adding an
// [api]/[auth]/[db] block there would push CLI defaults over the dashboard's),
// so the seed step does nothing and no migration inserts cards either.
//
// The consequence bit twice, silently, because the whole test suite reads the
// seed SOURCE and never the database:
//
//   * Wave 0 (2026-09-02) shipped hard card retirement — validateDeck's
//     rejection, poolEligible's pool filter, the required DeckCardInfo.retired,
//     the DecksPage badge. None of it could fire: the five `retired: true` flags
//     never reached production, so retirement was inert for the whole window
//     between merge and discovery.
//   * The DWG/OW/WF balance waves then deployed new EFFECT CODE against the old
//     card rows, so three cards actively lied to players — Marauder's text
//     promised a 50k discount its rewritten effect no longer gave, Plunderer
//     charged a surcharge its text never mentioned, and Excruciator's behaviour
//     had nothing to do with its printed line.
//
// Spec §1 keeps each faction's data and effects in one commit precisely so that
// never happens. That guarantee holds in the repo and breaks at the deploy,
// because functions ship automatically and seed data does not. Run this after
// any merge that touches supabase/seed/source/**.
//
// Usage
//   node scripts/verify-seed.mjs          # or: npm run seed:verify
//
// Env
//   SUPABASE_ACCESS_TOKEN  required — personal access token (sbp_...), the same
//                          one functions:deploy needs. Read from the process
//                          environment first, then ./.env.local.
//   SUPABASE_PROJECT_REF   optional, defaults to the project below.

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PROJECT_REF = 'wpgsjnjnvykxavaxibld'
const API = 'https://api.supabase.com'
const SEED = path.join(ROOT, 'supabase/seed/seed_data.sql')

// Signals failure by UNWINDING, never process.exit(). Calling process.exit()
// while the Management API socket is still closing aborts the Windows event
// loop with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and exits
// 127 — a crash, not the exit 1 a CI gate is looking for. Setting exitCode and
// letting the process end naturally is deterministic on every platform.
class SeedCheckError extends Error {}
const die = (msg) => { throw new SeedCheckError(msg) }

// Same minimal reader as deploy-function.mjs: process env wins over the file.
function readEnvLocal(dir) {
  const file = path.join(dir, '.env.local')
  if (!existsSync(file)) return {}
  const out = {}
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}
const fileEnv = readEnvLocal(ROOT)
const envValue = (k) => process.env[k] || fileEnv[k]

// Order-independent, DEEP canonicalisation.
//
// ⚠ Do NOT "simplify" this to JSON.stringify(v, Object.keys(v).sort()). A key
// ARRAY passed as the replacer filters at EVERY nesting level, so nested objects
// come back blanked — {"resourceSurge":{"extraSpawns":1}} canonicalises to
// {"resourceSurge":{}} and every difference inside it compares equal. The first
// draft of this comparison did exactly that and reported a clean match while
// silently ignoring all nested meta.
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}
const canonStr = (s) => { try { return canon(JSON.parse(s)) } catch { return JSON.stringify(s) } }

// seed_data.sql is generated as fixed 3-line statements, so the values tuple is
// parsed positionally. Single quotes are doubled inside SQL string literals.
function splitTuple(s) {
  const out = []
  let i = 0
  let cur = ''
  while (i < s.length) {
    const c = s[i]
    if (c === "'") {
      let v = ''
      i++
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2 } else if (s[i] === "'") { i++; break } else v += s[i++]
      }
      while (s.startsWith('::jsonb', i)) i += 7
      out.push(v)
      cur = null
    } else if (c === ',') {
      if (cur !== null) out.push(cur.trim())
      cur = ''
      i++
    } else if (cur === null) { i++ } else { cur += c; i++ }
  }
  if (cur) out.push(cur.trim())
  return out
}

// Column order of the generated cards insert. Hero-power statements have a
// different arity and are skipped by the length check below.
const CARD_TUPLE_LEN = 14
function expectedFromSeed() {
  if (!existsSync(SEED)) die(`missing ${SEED} — run \`npm run seed:build\` first`)
  const map = new Map()
  for (const line of readFileSync(SEED, 'utf8').split('\n')) {
    if (!line.startsWith('values (') || !line.endsWith(')')) continue
    const t = splitTuple(line.slice('values ('.length, -1))
    if (t.length !== CARD_TUPLE_LEN) continue
    map.set(`${t[4]}:${t[1]}`, {
      type: t[5],
      vehicle_type: t[6] === 'null' ? null : t[6],
      blueprint_cost: Number(t[7]),
      material_cost: Number(t[8]),
      cp_cost: Number(t[9]),
      card_text: t[10],
      image_url: t[11],
      keywords: canonStr(t[12]),
      meta: canonStr(t[13]),
    })
  }
  if (map.size === 0) die('parsed 0 cards out of seed_data.sql — the generated format changed')
  return map
}

async function liveCards(token, ref) {
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `select faction, name, type, vehicle_type, blueprint_cost, material_cost,
                     cp_cost, card_text, image_url, keywords, meta
              from public.cards where is_built_in = true`,
    }),
  })
  if (!res.ok) die(`Management API ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

const FIELDS = ['type', 'vehicle_type', 'blueprint_cost', 'material_cost', 'cp_cost',
  'card_text', 'image_url', 'keywords', 'meta']

async function main() {
  const token = envValue('SUPABASE_ACCESS_TOKEN')
  if (!token) {
    die('SUPABASE_ACCESS_TOKEN is not set.\n' +
        '  Create one at https://supabase.com/dashboard/account/tokens, then either\n' +
        '  add it to ./.env.local (gitignored) as SUPABASE_ACCESS_TOKEN=sbp_... or set\n' +
        '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   (PowerShell)')
  }
  const ref = envValue('SUPABASE_PROJECT_REF') || DEFAULT_PROJECT_REF

  const expected = expectedFromSeed()
  const rows = await liveCards(token, ref)
  const live = new Map(rows.map((r) => [`${r.faction}:${r.name}`, r]))

  let drift = 0
  for (const [key, want] of expected) {
    const got = live.get(key)
    if (!got) { console.log(`\x1b[31mMISSING FROM DB\x1b[0m  ${key}`); drift++; continue }
    for (const f of FIELDS) {
      const gotV = (f === 'keywords' || f === 'meta') ? canon(got[f]) : got[f]
      if (String(gotV) !== String(want[f])) {
        console.log(`\x1b[31mDRIFT\x1b[0m ${key}.${f}\n   live: ${gotV}\n   seed: ${want[f]}`)
        drift++
      }
    }
  }
  for (const key of live.keys()) {
    if (!expected.has(key)) { console.log(`\x1b[31mEXTRA IN DB\x1b[0m  ${key} (built-in row not in seed)`); drift++ }
  }

  console.log(`\nseed cards: ${expected.size}   live built-in cards: ${live.size}   drift: ${drift}`)
  if (drift > 0) {
    console.error('\x1b[31m\nProduction does NOT match seed_data.sql.\x1b[0m')
    console.error('Apply the seed upserts against the project, then re-run this check.')
    process.exitCode = 1
    return
  }
  console.log('\x1b[32mProduction matches seed_data.sql exactly.\x1b[0m')
}

try {
  await main()
} catch (err) {
  console.error(`\x1b[31m${err instanceof SeedCheckError ? err.message : err}\x1b[0m`)
  process.exitCode = 1
}
