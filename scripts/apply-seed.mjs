#!/usr/bin/env node
// Applies supabase/seed/seed_data.sql to the LIVE project, byte-exact, through
// the Management API — the counterpart of verify-seed.mjs.
//
// Why this exists
// ---------------
// Merging deploys CODE, never card data: the GitHub integration's seed step is
// a no-op here (config.toml carries no seed settings) and no migration inserts
// cards, so every merge touching supabase/seed/source/** leaves production on
// the OLD rows while the new effect code is already live. verify-seed.mjs
// reports that drift; this script closes it. Every statement in seed_data.sql
// is an idempotent `insert … on conflict (id) do update`, so re-running is
// safe and nothing is ever deleted.
//
// The file is posted in statement batches rather than retyped or pasted: a
// hand transcription of 150 KB of card data is exactly how a number gets
// fat-fingered into production without any test noticing.
//
// Usage
//   node scripts/apply-seed.mjs            # or: npm run seed:apply
//   node scripts/apply-seed.mjs --dry-run  # count statements, send nothing
//
// Then run `npm run seed:verify` — it must exit 0.
//
// Env
//   SUPABASE_ACCESS_TOKEN  required — personal access token (sbp_...), the same
//                          one functions:deploy and seed:verify use. Read from
//                          the process environment first, then ./.env.local.
//   SUPABASE_PROJECT_REF   optional, defaults to the project below.

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PROJECT_REF = 'wpgsjnjnvykxavaxibld'
const API = 'https://api.supabase.com'
const SEED = path.join(ROOT, 'supabase/seed/seed_data.sql')
// Statements per request. The endpoint takes one SQL text per call and runs it
// as a single implicit transaction, so a batch lands whole or not at all; the
// next run picks up where a failed one stopped because every statement is an
// upsert.
const BATCH = 40

// Signals failure by UNWINDING, never process.exit() — see verify-seed.mjs for
// why (the Windows event loop aborts if exit() races a closing socket).
class SeedApplyError extends Error {}
const die = (msg) => { throw new SeedApplyError(msg) }

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

// seed_data.sql is generated as fixed 3-line statements, each ending in `;` at
// end of line, with a leading `--` comment. Split on that terminator only — a
// `;` inside a card_text literal never sits at a line end.
function statementsFromSeed() {
  if (!existsSync(SEED)) die(`missing ${SEED} — run \`npm run seed:build\` first`)
  const body = readFileSync(SEED, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('--')).join('\n')
  const stmts = body.split(/;\r?\n/).map((s) => s.trim()).filter(Boolean)
  const bad = stmts.find((s) => !/^insert into public\.(cards|hero_powers) /.test(s) || !/\bon conflict \(id\) do update\b/.test(s))
  if (bad) die(`refusing to run a statement that is not an upsert into cards/hero_powers:\n  ${bad.slice(0, 120)}…`)
  if (stmts.length === 0) die('parsed 0 statements out of seed_data.sql — the generated format changed')
  return stmts
}

async function runSql(token, ref, sql) {
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) die(`Management API ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const stmts = statementsFromSeed()
  const cards = stmts.filter((s) => s.startsWith('insert into public.cards ')).length
  const powers = stmts.length - cards
  const batches = []
  for (let i = 0; i < stmts.length; i += BATCH) batches.push(stmts.slice(i, i + BATCH).map((s) => `${s};`).join('\n'))
  console.log(`seed_data.sql: ${stmts.length} upserts (${cards} cards, ${powers} hero powers) in ${batches.length} batches`)
  if (dryRun) { console.log('dry run — nothing sent'); return }

  const token = envValue('SUPABASE_ACCESS_TOKEN')
  if (!token) {
    die('SUPABASE_ACCESS_TOKEN is not set.\n' +
        '  Create one at https://supabase.com/dashboard/account/tokens, then either\n' +
        '  add it to ./.env.local (gitignored) as SUPABASE_ACCESS_TOKEN=sbp_... or set\n' +
        '  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   (PowerShell)')
  }
  const ref = envValue('SUPABASE_PROJECT_REF') || DEFAULT_PROJECT_REF

  for (const [i, sql] of batches.entries()) {
    await runSql(token, ref, sql)
    console.log(`  batch ${i + 1}/${batches.length} applied`)
  }
  const [{ built_in }] = await runSql(token, ref, 'select count(*)::int as built_in from public.cards where is_built_in = true')
  console.log(`done — live built-in cards: ${built_in} (seed: ${cards}). Now run: npm run seed:verify`)
  if (built_in !== cards) die(`live built-in count ${built_in} ≠ seed ${cards}; a row is missing or extra — run seed:verify`)
}

try {
  await main()
} catch (err) {
  console.error(`\x1b[31m${err instanceof SeedApplyError ? err.message : err}\x1b[0m`)
  process.exitCode = 1
}
