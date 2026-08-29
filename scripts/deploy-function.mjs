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
// The token is read from the environment and never printed, logged, or
// written anywhere. Nothing else in this script touches secrets.
//
// verify_jwt defaults to FALSE, which is correct for every function in this
// repo: all three do their own getUser() auth check and CORS handling in
// code (see docs/claude/supabase.md). Pass --verify-jwt only if that ever
// stops being true — turning it on breaks every client call in production.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  die('SUPABASE_ACCESS_TOKEN is not set.\n' +
      '    Create one at https://supabase.com/dashboard/account/tokens, then:\n' +
      '      export SUPABASE_ACCESS_TOKEN=sbp_...      (bash)\n' +
      '      $env:SUPABASE_ACCESS_TOKEN = "sbp_..."    (PowerShell)\n' +
      '    The script reads it from the environment and never prints or stores it.')
}
const projectRef = process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF

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
