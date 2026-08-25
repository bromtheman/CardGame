// Copies the shared modules the create-card function needs into the function
// directory (Deno deploys can't reach outside it). Run: npm run functions:sync
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'supabase', 'functions', 'create-card', 'shared')
mkdirSync(dest, { recursive: true })
for (const f of ['gameSettings.ts', 'types.ts', 'customCards.ts']) {
  copyFileSync(join(root, 'shared', f), join(dest, f))
  console.log(`synced shared/${f}`)
}
