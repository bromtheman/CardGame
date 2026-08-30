#!/usr/bin/env node
// Deploy one Supabase edge function with its COMPLETE file payload.
//
// Why this exists: a deploy sends the whole file set, and a partial payload
// DELETES the files it omits — a missing runtime module makes the function
// fail at boot for every player. Assembling that payload by hand is both
// tedious and unsafe, so this script derives it from the same
// shared-manifest.json that `npm run functions:sync` reads. The two can
// therefore never disagree about which files a function needs.
//
// Usage:
//   node scripts/deploy-function.mjs <function-name> [--dry-run] [--verify-jwt]
//
//   SUPABASE_ACCESS_TOKEN   required (except --dry-run) — a personal access
//                           token from https://supabase.com/dashboard/account/tokens
//   SUPABASE_PROJECT_REF    optional, defaults to the project in docs/claude/supabase.md
//
// Both are read from the process environment first and, failing that, from
// `.env.local` at the REPO ROOT — the directory holding this `scripts/` folder,
// which is the worktree root when run from one. Deliberately NOT
// `frontend/.env.local`: that file holds only the publishable anon key and is a
// browser bundle's input, so a management token must never live there.
//
// The token is never printed, logged, or written anywhere, and `.env.local` is
// covered by `.gitignore`'s `.env.*`. Nothing else in this script touches
// secrets.
//
// verify_jwt defaults to FALSE, which is correct for every function in this
// repo: all three do their own getUser() auth check and CORS handling in
// code (see docs/claude/supabase.md). Pass --verify-jwt only if that ever
// stops being true — turning it on breaks every client call in production.

import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PROJECT_REF = 'wpgsjnjnvykxavaxibld'
const API = 'https://api.supabase.com'

const args = process.argv.slice(2)
const fnName = args.find((a) => !a.startsWith('--'))
const dryRun = args.includes('--dry-run')
const verifyJwt = args.includes('--verify-jwt')

function die(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

// Minimal `.env.local` reader: `KEY=value`, `export KEY=value`, optional
// surrounding quotes, `#` comments and blank lines skipped. Deliberately not a
// dotenv dependency — this reads one file, for two known keys, and a parser
// that silently mangles a token is worse than none.
//
// The process environment WINS, so `$env:SUPABASE_ACCESS_TOKEN = "..."` still
// overrides the file exactly as it did before.
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
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

const fileEnv = readEnvLocal(ROOT)
const envValue = (key) => process.env[key] || fileEnv[key] || ''

if (!fnName) {
  die('Usage: node scripts/deploy-function.mjs <function-name> [--dry-run] [--verify-jwt]')
}

// ---------------------------------------------------------------- file list

const manifestPath = path.join(ROOT, 'supabase/functions/shared-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const sharedFiles = manifest[fnName]
if (!Array.isArray(sharedFiles)) {
  die(`"${fnName}" is not in shared-manifest.json. Known: ${Object.keys(manifest).join(', ')}`)
}

const fnDir = path.join(ROOT, 'supabase/functions', fnName)
if (!existsSync(fnDir)) die(`No such function directory: ${path.relative(ROOT, fnDir)}`)

// The entry file plus every synced shared module, in manifest order.
const relPaths = ['index.ts', ...sharedFiles.map((f) => `shared/${f}`)]

const files = []
for (const rel of relPaths) {
  const abs = path.join(fnDir, rel)
  if (!existsSync(abs)) {
    die(`Manifest lists "${rel}" but it is missing from ${path.relative(ROOT, fnDir)}.\n` +
        '    Run `npm run functions:sync` first.')
  }
  // Read as a Buffer and hand the raw bytes to the API. Deliberately no
  // text decoding, re-encoding, or line-ending normalisation — the deployed
  // bytes must be exactly the bytes on disk.
  files.push({ rel, bytes: await readFile(abs) })
}

const totalBytes = files.reduce((n, f) => n + f.bytes.length, 0)

console.log(`\n  ${fnName} — ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KB`)
console.log(`  verify_jwt: ${verifyJwt}${verifyJwt ? '  ⚠ every client call must send a JWT' : ''}`)
for (const f of files) {
  console.log(`    ${f.rel.padEnd(38)} ${String(f.bytes.length).padStart(7)} bytes`)
}

if (dryRun) {
  console.log('\n  --dry-run: nothing sent.\n')
  process.exit(0)
}

// ------------------------------------------------------------------- deploy

const token = envValue('SUPABASE_ACCESS_TOKEN')
if (!token) {
  die('SUPABASE_ACCESS_TOKEN is not set.\n' +
      '    Create one at https://supabase.com/dashboard/account/tokens, then EITHER\n' +
      '    put it in .env.local at the REPO ROOT (gitignored via .env.*):\n' +
      '      SUPABASE_ACCESS_TOKEN=sbp_...\n' +
      '    or set it in the environment, which takes precedence:\n' +
      '      export SUPABASE_ACCESS_TOKEN=sbp_...      (bash)\n' +
      '      $env:SUPABASE_ACCESS_TOKEN = "sbp_..."    (PowerShell)\n' +
      '    The repo root, NOT frontend/.env.local — that one is a browser bundle\n' +
      '    input and holds only the publishable anon key.\n' +
      '    Either way the value is never printed or stored by this script.')
}
const projectRef = envValue('SUPABASE_PROJECT_REF') || DEFAULT_PROJECT_REF

const form = new FormData()
form.append('metadata', JSON.stringify({
  name: fnName,
  entrypoint_path: 'index.ts',
  verify_jwt: verifyJwt,
}))
for (const f of files) {
  // The part's filename becomes the module's path inside the function, so
  // relative imports resolve exactly as they do on disk.
  form.append('file', new Blob([f.bytes], { type: 'application/typescript' }), f.rel)
}

const url = `${API}/v1/projects/${projectRef}/functions/deploy?slug=${encodeURIComponent(fnName)}`
console.log(`\n  → POST /v1/projects/${projectRef}/functions/deploy?slug=${fnName}`)

let res
try {
  res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
} catch (err) {
  die(`Request failed: ${err.message}`)
}

const text = await res.text()
if (!res.ok) {
  // Never echo the token; the body may contain the API's own error detail.
  die(`Deploy failed — HTTP ${res.status}\n    ${text.slice(0, 800)}`)
}

let body
try { body = JSON.parse(text) } catch { body = {} }
console.log(`\n  ✓ deployed ${fnName} — version ${body.version ?? '(not reported)'}, status ${body.status ?? 'unknown'}`)
console.log('\n  Verify by CONTENT, not file count: a deployed function legitimately')
console.log('  reads back with fewer modules than you sent, because type-only')
console.log('  imports are erased during transpilation. See docs/claude/supabase.md.\n')
