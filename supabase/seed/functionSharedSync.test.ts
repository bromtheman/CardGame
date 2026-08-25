import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest: Record<string, string[]> = JSON.parse(
  readFileSync(join(ROOT, 'supabase', 'functions', 'shared-manifest.json'), 'utf8'),
)

describe('function shared-module sync', () => {
  for (const [fn, files] of Object.entries(manifest)) {
    for (const f of files) {
      it(`${fn}/shared/${f} matches shared/${f}`, () => {
        const source = readFileSync(join(ROOT, 'shared', f), 'utf8')
        const synced = readFileSync(
          join(ROOT, 'supabase', 'functions', fn, 'shared', f),
          'utf8',
        )
        expect(synced).toBe(source)
      })
    }
  }
})
