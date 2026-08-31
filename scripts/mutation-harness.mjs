// Reusable mutation-testing runner.
//
// Wave 5 ran 62 mutations and kept its harness in a gitignored scratchpad, so
// wave 6 had to rebuild it — and rebuilt both of its bugs along the way. This
// lives in scripts/ so the next wave inherits the fixes instead.
//
// Usage: write a list of [file, from, to, label] tuples and call runMutations.
// Each tuple replaces `from` with `to` in `file`, runs the suite, restores the
// file, and reports whether anything failed. A mutation that SURVIVES is the
// finding: some test claimed to cover that line and did not.
//
//   import { runMutations } from '../scripts/mutation-harness.mjs'
//   runMutations([
//     ['shared/engine/placement.ts', 'a > b', 'a >= b', 'boundary flipped'],
//   ])
//
// Two things this had to learn the hard way, both worth carrying forward:
//
// 1. SCOPE. `npx vitest run shared supabase/seed` includes
//    functionSharedSync.test.ts, which compares shared/ to its copy under
//    supabase/functions/game-action/. That test fails for ANY edit to a
//    shared/ file — so every mutation is "killed" trivially and the run
//    proves nothing. Wave 5 warned about false SURVIVORS from a too-narrow
//    scope; this is the mirror, and worse, because a false kill hides a real
//    survivor instead of merely wasting an investigation.
//
// 2. LINE ENDINGS. shared/ is MIXED — some files LF, some CRLF, depending on
//    which tool last wrote them. A multi-line anchor written with \n silently
//    misses a CRLF file, which the harness then reports as a skip rather than
//    a result. Match against a normalised copy; restore the exact original
//    bytes afterwards so nothing drifts.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Deliberately excludes functionSharedSync.test.ts and seedDataSync.test.ts —
// see note 1 above — while keeping the WHOLE of shared/, per wave 5's caution
// against file-scoped runs.
// A POSITIONAL filter is NOT enough. vitest matches it case-insensitively
// against the whole path, so `shared` also selects
// supabase/seed/functionSharedSync.test.ts — the one test that fails for any
// edit to a shared/ file. Excluding it explicitly is the only thing that makes
// a kill mean something. Verified with `npx vitest list`, not assumed.
const SCOPE = [
  'npx vitest run shared',
  'supabase/seed/effectCoverage.test.ts',
  'supabase/seed/balancePass.test.ts',
  '--exclude "**/functionSharedSync.test.ts"',
  '--exclude "**/seedDataSync.test.ts"',
  '--reporter=dot',
].join(' ')

export function runMutations(mutations) {
  let survived = 0
  let killed = 0
  const survivors = []

  for (const [file, from, to, label] of mutations) {
    const raw = readFileSync(file, 'utf8')
    const normalised = raw.split('\r\n').join('\n')
    if (!normalised.includes(from)) {
      console.log(`  SKIP  ${label} — anchor not found in ${file}`)
      survivors.push(`${label} (ANCHOR NOT FOUND — the harness is stale, not the code)`)
      continue
    }
    writeFileSync(file, normalised.replace(from, to))
    let died = false
    try {
      execSync(SCOPE, { stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch {
      died = true
    }
    writeFileSync(file, raw)
    if (died) {
      killed++
      console.log(`  kill  ${label}`)
    } else {
      survived++
      survivors.push(label)
      console.log(`  LIVE  ${label}`)
    }
  }

  console.log(`\n${killed} killed, ${survived} survived, ${mutations.length} total`)
  if (survivors.length) console.log('\nSURVIVORS:\n' + survivors.map((s) => `  - ${s}`).join('\n'))
  return { killed, survived, survivors }
}
