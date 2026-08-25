import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('function shared-module sync', () => {
  for (const f of ['gameSettings.ts', 'types.ts', 'customCards.ts']) {
    it(`supabase/functions/create-card/shared/${f} matches shared/${f}`, () => {
      const source = readFileSync(join(ROOT, 'shared', f), 'utf8')
      const synced = readFileSync(
        join(ROOT, 'supabase', 'functions', 'create-card', 'shared', f),
        'utf8',
      )
      expect(synced).toBe(source)
    })
  }
})
