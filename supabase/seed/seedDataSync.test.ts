import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSeedSql, loadSeedData } from './transform'

// supabase/seed/seed_data.sql is a TRACKED, GENERATED file — supabase/seed/
// cli.ts writes buildSeedSql(loadSeedData()) to it verbatim, and the deploy
// applies this file, not source/*.js. Every other seed test (effectCoverage,
// transform) reads source/*.js straight through loadSeedData(), so a stale
// committed .sql passes all of them while shipping nothing: a card can be
// fully wired in source/*.js, pass G1/G2/G3, and still be dead in production
// because nobody ran `npm run seed:build` after editing the source. This is
// the one test that actually reads the committed file and would have caught
// that.
const SEED_SQL_PATH = join(dirname(fileURLToPath(import.meta.url)), 'seed_data.sql')

describe('seed_data.sql generation sync', () => {
  it('matches buildSeedSql(loadSeedData()) exactly — run `npm run seed:build` if this fails', async () => {
    const { cards, heroPowers } = await loadSeedData()
    const rendered = buildSeedSql(cards, heroPowers)
    // Normalize CRLF -> LF on the committed read only. cli.ts's writeFileSync
    // always emits bare \n (buildSeedSql joins with '\n'), but this file is
    // tracked and Windows' core.autocrlf smudges tracked text files to CRLF
    // on checkout — confirmed while writing this test: `git checkout --` on
    // this exact file left 390 CRLFs in the working tree with `git diff`
    // reporting zero content change. Without this normalization the test
    // would fail on every such checkout regardless of whether the content is
    // actually stale, which is the opposite of what a drift guard is for.
    const committed = readFileSync(SEED_SQL_PATH, 'utf8').replace(/\r\n/g, '\n')
    expect(rendered).toBe(committed)
  })
})
